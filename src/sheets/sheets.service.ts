import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);
  private authClient: any = null;
  private isMock = true;
  private spreadsheetId = '';

  constructor(configService: ConfigService) {
    const serviceAccountEmail = configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = configService.get<string>('GOOGLE_PRIVATE_KEY');
    this.spreadsheetId = configService.get<string>('GOOGLE_SPREADSHEET_ID') || '';

    // Check if we have real credentials
    if (
      serviceAccountEmail &&
      privateKey &&
      !serviceAccountEmail.includes('mock') &&
      !privateKey.includes('Mock')
    ) {
      try {
        const formattedKey = privateKey.replace(/\\n/g, '\n');
        this.authClient = new google.auth.JWT({
          email: serviceAccountEmail,
          key: formattedKey,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        this.isMock = false;
        this.logger.log('Google Sheets service initialized successfully.');
      } catch (error) {
        this.logger.error('Failed to initialize Google Sheets service, falling back to mock calculator', error.stack);
      }
    } else {
      this.logger.warn('Using mock estimator logic (no Google Sheets credentials provided).');
    }
  }

  /**
   * Calculates a quote by writing inputs to Google Sheets and reading the output,
   * or using local fallback math if credentials are not set.
   * Inputs format:
   * {
   *   houseSize: string; // e.g. "1 Bedroom", "3 Bedroom House", "Apartment"
   *   stairs: number;    // flights of stairs
   *   heavyItems: string[]; // e.g. ["Piano", "Pool Table"]
   *   distance: number;  // distance in miles
   * }
   */
  async calculateQuote(inputs: {
    houseSize: string;
    stairs: number;
    heavyItems: string[];
    distance: number;
  }): Promise<number> {
    if (this.isMock || !this.authClient) {
      return this.calculateLocalEstimate(inputs);
    }

    try {
      const sheets = google.sheets({ version: 'v4', auth: this.authClient });

      // 1. Write the input values to the calculator spreadsheet.
      // We assume a standard input layout:
      // B2: House Size / Type
      // B3: Flights of stairs
      // B4: Distance (miles)
      // B5: Number of heavy items
      const heavyItemsCount = inputs.heavyItems?.length || 0;

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Calculator!B2:B5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            [inputs.houseSize],
            [inputs.stairs],
            [inputs.distance],
            [heavyItemsCount],
          ],
        },
      });

      // 2. Read the calculated output from the cell containing the final quote formula.
      // We assume the final price is calculated in cell C10.
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Calculator!C10',
      });

      const rows = response.data.values;
      if (rows && rows.length > 0 && rows[0][0]) {
        const rawPrice = rows[0][0].toString().replace(/[^0-9.]/g, '');
        const price = parseFloat(rawPrice);
        if (!isNaN(price)) {
          return price;
        }
      }

      this.logger.error('Failed to parse price from Google Sheets output, using local fallback');
      return this.calculateLocalEstimate(inputs);
    } catch (error) {
      this.logger.error('Google Sheets API communication failed, using local fallback', error.stack);
      return this.calculateLocalEstimate(inputs);
    }
  }

  /**
   * Senior fallback algorithm:
   * Safe, deterministic mathematical calculation matching moving industry standard pricing
   */
  private calculateLocalEstimate(inputs: {
    houseSize: string;
    stairs: number;
    heavyItems: string[];
    distance: number;
  }): number {
    let basePrice = 150; // Base dispatch cost

    // Room/size calculations
    const size = inputs.houseSize?.toLowerCase() || '';
    if (size.includes('1 bedroom') || size.includes('apartment')) {
      basePrice += 150;
    } else if (size.includes('2 bedroom')) {
      basePrice += 300;
    } else if (size.includes('3 bedroom') || size.includes('house')) {
      basePrice += 500;
    } else if (size.includes('4 bedroom') || size.includes('large')) {
      basePrice += 750;
    } else {
      basePrice += 200; // Default size charge
    }

    // Stairs charge: $75 per flight
    const flightCharge = (inputs.stairs || 0) * 75;

    // Heavy items charge: $150 per heavy item (pool tables, pianos, safes)
    const heavyItemsCharge = (inputs.heavyItems?.length || 0) * 150;

    // Distance charge: $3 per mile
    const distanceCharge = (inputs.distance || 0) * 3;

    const total = basePrice + flightCharge + heavyItemsCharge + distanceCharge;

    // Keep it realistic (e.g. minimum $200)
    return Math.max(total, 200);
  }
}
