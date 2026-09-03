import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { CreateQuoteDto } from './dto/quote.dto';

type QuoteResult = {
  quoteId: string;
  estimatedTotal: number;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  createdAt: Date;
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);
  private readonly memoryQuotes = new Map<string, QuoteResult>();

  constructor(
    private prisma: PrismaService,
    private sheetsService: SheetsService,
  ) {}

  async createQuote(dto: CreateQuoteDto) {
    this.logger.log(`Received quote request for customer: ${dto.email}`);

    // 1. Calculate price quote via Google Sheets / fallback
    const estimatedTotal = await this.sheetsService.calculateQuote({
      houseSize: dto.houseSize,
      bedrooms: dto.bedrooms,
      stairs: dto.stairs,
      originAccess: dto.originAccess,
      destinationAccess: dto.destinationAccess,
      elevatorWait: dto.elevatorWait,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
      packingHelp: dto.packingHelp,
    });

    this.logger.log(`Calculated price quote: $${estimatedTotal}`);

    try {
      return await this.persistQuote(dto, estimatedTotal);
    } catch (error) {
      this.logger.error(
        'PostgreSQL could not save the quote. Returning the Instant Quote Price from the sheet so the wizard can continue.',
        error instanceof Error ? error.stack : undefined,
      );
      return this.storeQuoteInMemory(dto, estimatedTotal);
    }
  }

  private async persistQuote(dto: CreateQuoteDto, estimatedTotal: number): Promise<QuoteResult> {
    const customer = await this.prisma.customer.upsert({
      where: { email: dto.email.toLowerCase() },
      update: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        addressLine1: dto.addressLine1 || null,
        addressLine2: dto.addressLine2 || null,
        city: dto.city || null,
        state: dto.state || null,
        zip: dto.zip || null,
      },
      create: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        addressLine1: dto.addressLine1 || null,
        addressLine2: dto.addressLine2 || null,
        city: dto.city || null,
        state: dto.state || null,
        zip: dto.zip || null,
      },
    });

    const rawInputs = this.buildRawInputs(dto);
    const rawOutput = this.buildRawOutput(estimatedTotal);

    const quote = await this.prisma.quote.create({
      data: {
        customerId: customer.id,
        rawInputs,
        rawOutput,
        estimatedTotal,
      },
    });

    return {
      quoteId: quote.id,
      estimatedTotal: Number(quote.estimatedTotal),
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
      createdAt: quote.createdAt,
    };
  }

  private storeQuoteInMemory(dto: CreateQuoteDto, estimatedTotal: number): QuoteResult {
    const result: QuoteResult = {
      quoteId: randomUUID(),
      estimatedTotal,
      customer: {
        id: randomUUID(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
      },
      createdAt: new Date(),
    };
    this.memoryQuotes.set(result.quoteId, result);
    return result;
  }

  private buildRawInputs(dto: CreateQuoteDto) {
    return {
      firstName: dto.firstName,
      lastName: dto.lastName,
      houseSize: dto.houseSize,
      bedrooms: dto.bedrooms,
      stairs: dto.stairs,
      originAccess: dto.originAccess,
      destinationAccess: dto.destinationAccess,
      elevatorWait: dto.elevatorWait,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
      packingHelp: dto.packingHelp,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      zip: dto.zip,
    };
  }

  private buildRawOutput(estimatedTotal: number) {
    return {
      price: estimatedTotal,
      calculatorVersion: 'QuoteCalculator_v14',
      computedAt: new Date().toISOString(),
    };
  }

  async updateQuote(id: string, dto: CreateQuoteDto) {
    this.logger.log(`Updating quote ${id} for customer: ${dto.email}`);

    let existingQuote: {
      customerId: string;
      customer: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
      };
    } | null = null;

    try {
      existingQuote = await this.prisma.quote.findUnique({
        where: { id },
        include: { customer: true },
      });
    } catch (error) {
      this.logger.warn(
        `PostgreSQL unavailable while loading quote ${id}; checking in-memory store.`,
        error instanceof Error ? error.message : undefined,
      );
    }

    const memoryQuote = this.memoryQuotes.get(id);
    if (!existingQuote && !memoryQuote) {
      throw new NotFoundException(`Quote with ID ${id} not found`);
    }

    const estimatedTotal = await this.sheetsService.calculateQuote({
      houseSize: dto.houseSize,
      bedrooms: dto.bedrooms,
      stairs: dto.stairs,
      originAccess: dto.originAccess,
      destinationAccess: dto.destinationAccess,
      elevatorWait: dto.elevatorWait,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
      packingHelp: dto.packingHelp,
    });

    if (existingQuote) {
      try {
        const customer = await this.prisma.customer.update({
          where: { id: existingQuote.customerId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            addressLine1: dto.addressLine1 || null,
            addressLine2: dto.addressLine2 || null,
            city: dto.city || null,
            state: dto.state || null,
            zip: dto.zip || null,
          },
        });

        const updatedQuote = await this.prisma.quote.update({
          where: { id },
          data: {
            rawInputs: this.buildRawInputs(dto),
            rawOutput: this.buildRawOutput(estimatedTotal),
            estimatedTotal,
          },
        });

        return {
          quoteId: updatedQuote.id,
          estimatedTotal: Number(updatedQuote.estimatedTotal),
          customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
          },
          createdAt: updatedQuote.createdAt,
        };
      } catch (error) {
        this.logger.error(
          `PostgreSQL could not update quote ${id}. Keeping the Instant Quote Price in memory.`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    const result: QuoteResult = {
      quoteId: id,
      estimatedTotal,
      customer: {
        id: memoryQuote?.customer.id || existingQuote?.customer.id || randomUUID(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
      },
      createdAt: memoryQuote?.createdAt || new Date(),
    };
    this.memoryQuotes.set(id, result);
    return result;
  }
}
