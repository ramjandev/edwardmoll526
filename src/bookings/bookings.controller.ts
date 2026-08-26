import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Headers,
  BadRequestException,
  UnauthorizedException,
  Logger,
  UseGuards,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';
import { BookingResponseWrapperDto, BookingListResponseWrapperDto } from './dto/booking-response.dto';
import { PaymentsService } from '../payments/payments.service';
import { JobberService } from '../jobber/jobber.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhookSource, PaymentType } from '../generated/prisma/client';

/** Jobber topics this backend reacts to. Everything else is logged and ignored. */
const INVOICE_TOPICS = ['INVOICE_UPDATE', 'INVOICE_CREATE'];
const JOB_DONE_TOPICS = ['JOB_CLOSED', 'VISIT_COMPLETE', 'JOB_COMPLETED'];

@ApiTags('Bookings & Scheduling')
@Controller('bookings')
export class BookingsController {
  private readonly logger = new Logger(BookingsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly paymentsService: PaymentsService,
    private readonly jobberService: JobberService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Reserve a moving date and issue the Jobber deposit invoice' })
  @ApiResponse({
    status: 201,
    description: 'Booking created. Response contains the Jobber payment link.',
    type: BookingResponseWrapperDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed or date is fully booked' })
  async createBooking(@Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve booking log for administrators' })
  @ApiResponse({ status: 200, description: 'Returns all bookings with quote and payment details', type: BookingListResponseWrapperDto })
  async getBookings() {
    return this.bookingsService.getBookings();
  }

  @Post('jobber-webhook')
  @ApiOperation({
    summary: 'Jobber webhook listener (invoice payments and job completion)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      example: {
        data: {
          webHookEvent: {
            topic: 'INVOICE_UPDATE',
            accountId: 'MQ==',
            itemId: 'Z2lkOi8vSm9iYmVyL0ludm9pY2UvOTk5OTk5',
            occurredAt: '2026-03-19T16:31:36-06:00',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Jobber webhook event processed' })
  async handleJobberWebhook(
    @Req() req: any,
    @Headers('x-jobber-hmac-sha256') signature: string,
    @Body() payload: any,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(payload);

    if (!this.jobberService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.error('Rejected Jobber webhook: invalid HMAC signature');
      throw new UnauthorizedException('Invalid Jobber webhook signature');
    }

    // Real Jobber deliveries nest the event; the flat shape is kept for manual testing.
    const event = payload?.data?.webHookEvent ?? {};
    const topic: string = event.topic || payload?.topic || '';
    const itemId: string = event.itemId || payload?.resourceId || '';
    const occurredAt: string = event.occurredAt || new Date().toISOString();

    if (!topic || !itemId) {
      throw new BadRequestException('Webhook payload is missing topic or itemId');
    }

    this.logger.log(`Ingesting Jobber webhook ${topic} for ${itemId}`);

    // Jobber fires the same topic more than once per user action, so the
    // event identity has to include when it happened.
    const externalId = `${topic}:${itemId}:${occurredAt}`;

    const existingWebhook = await this.prisma.webhookEvent.findUnique({
      where: {
        source_externalId: {
          source: WebhookSource.JOBBER,
          externalId,
        },
      },
    });

    if (existingWebhook) {
      this.logger.warn(`Jobber event ${externalId} already processed. Skipping.`);
      return { received: true, duplicate: true };
    }

    const webhookLog = await this.prisma.webhookEvent.create({
      data: {
        source: WebhookSource.JOBBER,
        eventType: topic,
        externalId,
        payload,
        processed: false,
      },
    });

    try {
      let result: any = { ignored: true };

      if (INVOICE_TOPICS.includes(topic)) {
        result = await this.processInvoiceEvent(itemId);
      } else if (JOB_DONE_TOPICS.includes(topic)) {
        result = await this.bookingsService.handleJobCompleted(itemId);
      } else {
        this.logger.log(`No handler for Jobber topic ${topic}. Recorded only.`);
      }

      await this.prisma.webhookEvent.update({
        where: { id: webhookLog.id },
        data: { processed: true, processedAt: new Date() },
      });

      return { received: true, topic, result };
    } catch (error: any) {
      this.logger.error(`Failed to process Jobber webhook ${externalId}`, error.stack);

      await this.prisma.webhookEvent.update({
        where: { id: webhookLog.id },
        data: { processed: false, processingError: error.message },
      });

      return { received: true, processed: false, error: error.message };
    }
  }

  /**
   * An invoice changed in Jobber. Settle it locally, and if it was the deposit,
   * schedule the job now that the date is actually paid for.
   */
  private async processInvoiceEvent(invoiceId: string) {
    const settled = await this.paymentsService.settleInvoiceIfPaid(invoiceId);

    if (!settled) {
      return { paid: false };
    }

    const { payment, type } = settled;

    await this.bookingsService.sendPaidReceipt(
      payment.bookingId,
      type,
      Number(payment.amount),
      payment.jobberInvoiceNumber || invoiceId,
    );

    if (type === PaymentType.DEPOSIT) {
      const scheduled = await this.bookingsService.handleDepositPaid(payment.bookingId);
      return { paid: true, type, ...scheduled };
    }

    return { paid: true, type };
  }

  @Post(':id/complete-offline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark booking complete and log an offline payment (cash/check)' })
  @ApiResponse({ status: 200, description: 'Booking successfully marked complete offline', type: BookingResponseWrapperDto })
  async completeOffline(@Param('id') bookingId: string) {
    return this.bookingsService.completeOffline(bookingId);
  }

  @Post(':id/simulate-deposit-paid')
  @ApiOperation({
    summary: 'DEV ONLY: simulate Jobber confirming the deposit invoice was paid',
  })
  @ApiResponse({ status: 200, description: 'Deposit marked paid and job scheduled in Jobber' })
  async simulateDepositPaid(@Param('id') bookingId: string) {
    if (!this.jobberService.mockMode) {
      throw new BadRequestException(
        'Simulation is disabled when real Jobber credentials are configured.',
      );
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking?.depositInvoiceId) {
      throw new BadRequestException(
        `Booking ${bookingId} has no deposit invoice to settle.`,
      );
    }

    return this.processInvoiceEvent(booking.depositInvoiceId);
  }
}
