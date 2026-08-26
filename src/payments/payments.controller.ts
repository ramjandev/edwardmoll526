import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreateInvoiceDto, RecordOfflinePaymentDto } from './dto/payment.dto';
import {
  PaymentLinkResponseWrapperDto,
  PaymentStatusResponseWrapperDto,
} from './dto/payment-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentMethod } from '../generated/prisma/client';

@ApiTags('Jobber Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('deposit-invoice')
  @ApiOperation({
    summary: 'Create the deposit invoice in Jobber and return the Client Hub payment link',
  })
  @ApiResponse({ status: 201, description: 'Deposit invoice created', type: PaymentLinkResponseWrapperDto })
  @ApiResponse({ status: 400, description: 'Deposit already paid' })
  async createDepositInvoice(@Body() dto: CreateInvoiceDto) {
    return this.paymentsService.createDepositInvoice(dto.bookingId);
  }

  @Post('balance-invoice')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create the final balance invoice in Jobber (admin)' })
  @ApiResponse({ status: 201, description: 'Balance invoice created', type: PaymentLinkResponseWrapperDto })
  async createBalanceInvoice(@Body() dto: CreateInvoiceDto) {
    return this.paymentsService.createBalanceInvoice(dto.bookingId);
  }

  @Get(':bookingId/status')
  @ApiOperation({
    summary: 'Check whether a booking has been paid in Jobber (polled by the frontend)',
  })
  @ApiResponse({ status: 200, description: 'Current payment state', type: PaymentStatusResponseWrapperDto })
  async getStatus(@Param('bookingId') bookingId: string) {
    return this.paymentsService.getBookingPaymentStatus(bookingId);
  }

  @Post('offline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a cash or check payment collected outside Jobber (admin)' })
  @ApiResponse({ status: 201, description: 'Offline payment recorded' })
  async recordOffline(@Body() dto: RecordOfflinePaymentDto) {
    return this.paymentsService.recordOfflinePayment(
      dto.bookingId,
      dto.type,
      dto.method || PaymentMethod.CASH,
    );
  }
}
