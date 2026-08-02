import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { CreateQuoteDto } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private sheetsService: SheetsService,
  ) {}

  async createQuote(dto: CreateQuoteDto) {
    this.logger.log(`Received quote request for customer: ${dto.email}`);

    // 1. Calculate price quote via Google Sheets / fallback
    const estimatedTotal = await this.sheetsService.calculateQuote({
      houseSize: dto.houseSize,
      stairs: dto.stairs,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
    });

    this.logger.log(`Calculated price quote: $${estimatedTotal}`);

    // 2. Find or create customer by email (upserting with split names and addresses)
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

    // 3. Save the Quote in the database using rawInputs and rawOutput json structures
    const rawInputs = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      houseSize: dto.houseSize,
      stairs: dto.stairs,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      zip: dto.zip,
    };

    const rawOutput = {
      price: estimatedTotal,
      calculatorVersion: 'GoogleSheets_v2',
      computedAt: new Date().toISOString(),
    };

    const quote = await this.prisma.quote.create({
      data: {
        customerId: customer.id,
        rawInputs,
        rawOutput,
        estimatedTotal,
      },
      include: {
        customer: true,
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

  async updateQuote(id: string, dto: CreateQuoteDto) {
    this.logger.log(`Updating quote ${id} for customer: ${dto.email}`);

    const existingQuote = await this.prisma.quote.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!existingQuote) {
      throw new NotFoundException(`Quote with ID ${id} not found`);
    }

    const estimatedTotal = await this.sheetsService.calculateQuote({
      houseSize: dto.houseSize,
      stairs: dto.stairs,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
    });

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

    const rawInputs = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      houseSize: dto.houseSize,
      stairs: dto.stairs,
      heavyItems: dto.heavyItems,
      distance: dto.distance,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      zip: dto.zip,
    };

    const rawOutput = {
      price: estimatedTotal,
      calculatorVersion: 'GoogleSheets_v2',
      computedAt: new Date().toISOString(),
    };

    const updatedQuote = await this.prisma.quote.update({
      where: { id },
      data: {
        rawInputs,
        rawOutput,
        estimatedTotal,
      },
      include: {
        customer: true,
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
  }
}
