import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';

const TAB = 'Quote Calculator';

export type QuoteSheetInputs = {
  houseSize: string;
  bedrooms?: number;
  stairs: number;
  originAccess?: string;
  destinationAccess?: string;
  elevatorWait?: string;
  heavyItems: string[];
  distance: number;
  packingHelp?: string;
};

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);
  private authClient: InstanceType<typeof google.auth.JWT> | null = null;
  private isMock = true;
  private spreadsheetId = '';
  private quoteLock: Promise<void> = Promise.resolve();

  constructor(configService: ConfigService) {
    const serviceAccountEmail = configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = configService.get<string>('GOOGLE_PRIVATE_KEY');
    this.spreadsheetId = configService.get<string>('GOOGLE_SPREADSHEET_ID') || '';

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
        this.logger.error(
          'Failed to initialize Google Sheets service, falling back to mock calculator',
          error instanceof Error ? error.stack : undefined,
        );
      }
    } else {
      this.logger.warn('Using mock estimator logic (no Google Sheets credentials provided).');
    }
  }

  async calculateQuote(inputs: QuoteSheetInputs): Promise<number> {
    if (this.isMock || !this.authClient) {
      return this.calculateLocalEstimate(inputs);
    }

    return this.withQuoteLock(async () => {
      try {
        const sheets = google.sheets({ version: 'v4', auth: this.authClient! });
        const mapped = mapWebsiteInputsToSheet(inputs);

        await this.writeQuoteInputs(sheets, mapped);

        const recommendedCrew = await this.readCell(sheets, 'E4');
        const crew = normalizeCrew(recommendedCrew);
        if (crew !== mapped.crewSize) {
          await this.writeCells(sheets, [{ range: `'${TAB}'!B12`, values: [[crew]] }]);
        }

        const priceCell = await this.readCell(sheets, 'E10');
        const price = parseMoney(priceCell);
        if (price === null) {
          this.logger.error(`Failed to parse Instant Quote Price from E10 (${priceCell}), using local fallback`);
          return this.calculateLocalEstimate(inputs);
        }

        this.logger.log(`Google Sheets Instant Quote Price: $${price.toFixed(2)}`);
        return price;
      } catch (error) {
        this.logger.error(
          'Google Sheets API communication failed, using local fallback',
          error instanceof Error ? error.stack : undefined,
        );
        return this.calculateLocalEstimate(inputs);
      }
    });
  }

  private async withQuoteLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.quoteLock;
    this.quoteLock = previous.then(() => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async writeQuoteInputs(
    sheets: sheets_v4.Sheets,
    mapped: ReturnType<typeof mapWebsiteInputsToSheet>,
  ) {
    await this.writeCells(sheets, [
      { range: `'${TAB}'!B4`, values: [[mapped.residenceType]] },
      { range: `'${TAB}'!B5`, values: [[mapped.bedrooms]] },
      { range: `'${TAB}'!B6`, values: [[mapped.originAccess]] },
      { range: `'${TAB}'!B7`, values: [[mapped.destinationAccess]] },
      { range: `'${TAB}'!B8`, values: [[mapped.elevatorWait]] },
      { range: `'${TAB}'!B9`, values: [[mapped.packing]] },
      { range: `'${TAB}'!B10`, values: [[mapped.distance]] },
      { range: `'${TAB}'!B11`, values: [['No']] },
      { range: `'${TAB}'!B12`, values: [[mapped.crewSize]] },
      { range: `'${TAB}'!H14`, values: [[mapped.appliances]] },
      { range: `'${TAB}'!H15`, values: [[mapped.safes]] },
      { range: `'${TAB}'!H16`, values: [[mapped.heavyFurniture]] },
      { range: `'${TAB}'!H17`, values: [[mapped.piano]] },
      { range: `'${TAB}'!H18`, values: [[mapped.otherSpecialty]] },
    ]);
  }

  private async writeCells(
    sheets: sheets_v4.Sheets,
    data: Array<{ range: string; values: (string | number)[][] }>,
  ) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });
  }

  private async readCell(sheets: sheets_v4.Sheets, cell: string): Promise<string> {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${TAB}'!${cell}`,
    });
    return response.data.values?.[0]?.[0]?.toString() ?? '';
  }

  private calculateLocalEstimate(inputs: QuoteSheetInputs): number {
    let basePrice = 150;
    const size = inputs.houseSize?.toLowerCase() || '';
    if (size.includes('1 bedroom') || size.includes('studio')) {
      basePrice += 150;
    } else if (size.includes('2 bedroom')) {
      basePrice += 300;
    } else if (size.includes('3 bedroom') || size.includes('house')) {
      basePrice += 500;
    } else if (size.includes('4 bedroom') || size.includes('large') || size.includes('5')) {
      basePrice += 750;
    } else {
      basePrice += 200;
    }

    const total =
      basePrice +
      (inputs.stairs || 0) * 75 +
      (inputs.heavyItems?.length || 0) * 150 +
      (inputs.distance || 0) * 3;

    return Math.max(total, 200);
  }
}

function mapWebsiteInputsToSheet(inputs: QuoteSheetInputs) {
  return {
    residenceType: mapResidenceType(inputs.houseSize || ''),
    bedrooms: mapBedrooms(inputs),
    originAccess: mapAccess(inputs.originAccess, inputs.stairs),
    destinationAccess: mapAccess(inputs.destinationAccess, inputs.stairs),
    elevatorWait: mapElevator(inputs.elevatorWait),
    packing: mapPacking(inputs.packingHelp),
    distance: Math.max(0, Number(inputs.distance) || 0),
    crewSize: '2',
    ...mapSpecialtyItems(inputs.heavyItems || []),
  };
}

function mapResidenceType(houseSize: string): 'Apartment' | 'Condo/Townhome' | 'House' {
  const value = houseSize.toLowerCase();
  if (value === 'apartment' || value.includes('apartment') || value.includes('studio') || value.includes('storage')) {
    return 'Apartment';
  }
  if (value.includes('condo') || value.includes('townhome')) return 'Condo/Townhome';
  if (value === 'house' || value.includes('house') || value.includes('office') || value.includes('senior')) {
    return 'House';
  }
  return 'Apartment';
}

function mapBedrooms(inputs: QuoteSheetInputs): string {
  if (inputs.bedrooms && inputs.bedrooms >= 1) {
    return String(Math.min(4, Math.max(1, Math.round(inputs.bedrooms))));
  }
  const value = (inputs.houseSize || '').toLowerCase();
  if (value.includes('studio')) return '1';
  if (value.includes('5') || value.includes('4')) return '4';
  if (value.includes('3')) return '3';
  if (value.includes('1')) return '1';
  if (value.includes('2')) return '2';
  return '2';
}

function mapAccess(
  access: string | undefined,
  stairs: number,
): 'No stairs' | '1 flight' | '2 flights' | '3+ flights' {
  if (access === 'No stairs' || access === '1 flight' || access === '2 flights' || access === '3+ flights') {
    return access;
  }
  if (!stairs || stairs <= 0) return 'No stairs';
  if (stairs === 1) return '1 flight';
  if (stairs === 2) return '2 flights';
  return '3+ flights';
}

function mapElevator(value?: string): 'None' | 'Moderate' | 'Significant' {
  if (value === 'Moderate' || value === 'Significant' || value === 'None') return value;
  return 'None';
}

function mapPacking(packingHelp?: string): 'None' | 'Partial' | 'Full' {
  if (packingHelp === 'None' || packingHelp === 'Partial' || packingHelp === 'Full') {
    return packingHelp;
  }
  const value = (packingHelp || '').toLowerCase();
  if (value.includes('full')) return 'Full';
  if (value.includes('partial') || value.includes('boxes')) return 'Partial';
  return 'None';
}

function mapSpecialtyItems(items: string[]) {
  let appliances = 'None';
  let safes = 'None';
  let heavyFurniture = 'None';
  let piano = 'None';
  let otherSpecialty = 'None';

  for (const raw of items) {
    const item = raw.trim();
    const mapped = SPECIALTY_MAP[item.toLowerCase()];
    if (!mapped) {
      continue;
    }
    if (mapped.slot === 'appliances') appliances = mapped.value;
    if (mapped.slot === 'safes') safes = mapped.value;
    if (mapped.slot === 'heavyFurniture') heavyFurniture = mapped.value;
    if (mapped.slot === 'piano') piano = mapped.value;
    if (mapped.slot === 'otherSpecialty') otherSpecialty = mapped.value;
  }

  return { appliances, safes, heavyFurniture, piano, otherSpecialty };
}

const SPECIALTY_MAP: Record<
  string,
  {
    slot: 'appliances' | 'safes' | 'heavyFurniture' | 'piano' | 'otherSpecialty';
    value: string;
  }
> = {
  refrigerator: { slot: 'appliances', value: 'Refrigerator' },
  washer: { slot: 'appliances', value: 'Washer' },
  dryer: { slot: 'appliances', value: 'Dryer' },
  'washer & dryer pair': { slot: 'appliances', value: 'Washer & dryer pair' },
  'stove / range': { slot: 'appliances', value: 'Other large appliance' },
  freezer: { slot: 'appliances', value: 'Freezer' },
  'gun safe (small)': { slot: 'safes', value: 'Gun safe' },
  'gun safe (large)': { slot: 'safes', value: 'Gun safe' },
  'gun safe': { slot: 'safes', value: 'Gun safe' },
  'document safe': { slot: 'safes', value: 'Small safe (under 200 lb)' },
  'heavy home safe': { slot: 'safes', value: 'Medium safe (200-500 lb)' },
  'armoire / wardrobe': { slot: 'heavyFurniture', value: 'Armoire / wardrobe' },
  'triple dresser': { slot: 'heavyFurniture', value: 'Other heavy piece' },
  'buffet / credenza': { slot: 'heavyFurniture', value: 'Other heavy piece' },
  'sleep sofa / futon': { slot: 'heavyFurniture', value: 'Other heavy piece' },
  'large desk': { slot: 'heavyFurniture', value: 'Other heavy piece' },
  'large sectional sofa': { slot: 'heavyFurniture', value: 'Large sectional sofa' },
  'pool table': { slot: 'heavyFurniture', value: 'Pool table' },
  treadmill: { slot: 'heavyFurniture', value: 'Treadmill' },
  'gym equipment / treadmill': { slot: 'heavyFurniture', value: 'Treadmill' },
  'upright piano': { slot: 'piano', value: 'Upright piano' },
  'console / spinet piano': { slot: 'piano', value: 'Console / spinet' },
  'console / spinet': { slot: 'piano', value: 'Console / spinet' },
  'baby grand': { slot: 'piano', value: 'Baby grand' },
  'full grand piano': { slot: 'piano', value: 'Grand piano' },
  'grand piano': { slot: 'piano', value: 'Grand piano' },
  'digital piano / keyboard': { slot: 'piano', value: 'Digital keyboard' },
  'hot tub': { slot: 'otherSpecialty', value: 'Hot tub' },
  'grandfather clock': { slot: 'otherSpecialty', value: 'Grandfather clock' },
  'large aquarium': { slot: 'otherSpecialty', value: 'Large aquarium' },
};

function normalizeCrew(raw: string): string {
  const match = raw.match(/[2-6]/);
  return match ? match[0] : '2';
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const price = parseFloat(cleaned);
  return Number.isFinite(price) ? price : null;
}
