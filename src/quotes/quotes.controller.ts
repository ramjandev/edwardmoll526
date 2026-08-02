import { Controller, Post, Body, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/quote.dto';
import { QuoteResponseDto, QuoteResponseWrapperDto } from './dto/quote-response.dto';

@ApiTags('Quote Estimator')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  @ApiOperation({ summary: 'Submit estimator inputs and generate a moving quote' })
  @ApiResponse({ status: 201, description: 'Quote generated successfully, returning final cost and Quote ID', type: QuoteResponseWrapperDto })
  async createQuote(@Body() dto: CreateQuoteDto) {
    return this.quotesService.createQuote(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing moving quote' })
  @ApiResponse({ status: 200, description: 'Quote updated successfully, returning final cost and Quote ID', type: QuoteResponseWrapperDto })
  async updateQuote(
    @Param('id') id: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.updateQuote(id, dto);
  }
}
