import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreateDepositIntentDto } from './dto/payment.dto';
import { PaymentIntentResponseDto, PaymentIntentResponseWrapperDto } from './dto/payment-response.dto';

@ApiTags('Stripe Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-intent')
  @ApiOperation({ summary: 'Create a Stripe PaymentIntent for the 30% deposit' })
  @ApiResponse({ status: 201, description: 'PaymentIntent created successfully', type: PaymentIntentResponseWrapperDto })
  async createIntent(@Body() dto: CreateDepositIntentDto) {
    return this.paymentsService.createDepositIntent(dto.bookingId);
  }
}
