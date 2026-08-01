import { Controller, Post, Get, Body, Req, Headers, BadRequestException, Logger, RawBodyRequest, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { PaymentsService } from '../payments/payments.service';
import { JobberService } from '../jobber/jobber.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookingStatus, WebhookSource, PaymentType, PaymentStatus } from '../generated/prisma/client';

@ApiTags('Bookings & Scheduling')
@Controller('bookings')
export class BookingsController {
  private readonly logger = new Logger(BookingsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly paymentsService: PaymentsService,
    private readonly jobberService: JobberService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Reserve a moving date (Pending deposit)' })
  @ApiResponse({ status: 201, description: 'Pending booking created successfully', type: BookingResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed or date is fully booked' })
  async createBooking(@Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve booking log for administrators' })
  @ApiResponse({ status: 200, description: 'Returns all bookings with quote and payment details' })
  async getBookings() {
    return this.bookingsService.getBookings();
  }

  @Post('stripe-webhook')
  @ApiOperation({ summary: 'Stripe Webhook listener (manages deposit success)' })
  @ApiResponse({ status: 200, description: 'Stripe webhook event processed' })
  async handleStripeWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);

    this.logger.log('Ingesting Stripe Webhook...');

    let event: any;
    try {
      if (signature && webhookSecret && !webhookSecret.includes('mock')) {
        event = this.paymentsService.constructWebhookEvent(rawBody, signature, webhookSecret);
      } else {
        this.logger.warn('Skipping Stripe webhook signature verification (mock mode)');
        event = req.body;
      }
    } catch (err: any) {
      this.logger.error(`Stripe signature verification failed: ${err.message}`);
      throw new BadRequestException(`Stripe Webhook Error: ${err.message}`);
    }

    const eventId = event.id || `evt_mock_${Date.now()}`;
    const eventType = event.type || 'payment_intent.succeeded';

    // 1. Webhook Idempotency Check: Prevent duplicate processing of the same Stripe event ID
    const existingWebhook = await this.prisma.webhookEvent.findUnique({
      where: {
        source_externalId: {
          source: WebhookSource.STRIPE,
          externalId: eventId,
        },
      },
    });

    if (existingWebhook) {
      this.logger.warn(`Stripe Event ID: ${eventId} has already been processed. Skipping duplicates.`);
      return { received: true, duplicate: true };
    }

    // 2. Create the WebhookEvent audit record
    const webhookLog = await this.prisma.webhookEvent.create({
      data: {
        source: WebhookSource.STRIPE,
        eventType,
        externalId: eventId,
        payload: event as any,
        processed: false,
      },
    });

    if (eventType === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;

      if (!bookingId) {
        this.logger.warn(`Stripe payment_intent.succeeded had no bookingId in metadata. Event ID: ${eventId}`);
        await this.prisma.webhookEvent.update({
          where: { id: webhookLog.id },
          data: { processed: true, processingError: 'No bookingId in metadata' },
        });
        return { received: true };
      }

      const paymentMethodId = intent.payment_method;

      try {
        await this.prisma.$transaction(async (tx) => {
          // Check if payment already recorded
          const existingPayment = await tx.payment.findUnique({
            where: { stripePaymentIntentId: intent.id },
          });

          if (existingPayment) {
            await tx.payment.update({
              where: { id: existingPayment.id },
              data: {
                status: PaymentStatus.SUCCEEDED,
                paidAt: new Date(),
              },
            });
          } else {
            await tx.payment.create({
              data: {
                bookingId,
                type: PaymentType.DEPOSIT,
                status: PaymentStatus.SUCCEEDED,
                amount: intent.amount / 100,
                stripePaymentIntentId: intent.id,
                paidAt: new Date(),
              },
            });
          }

          // Update Booking Status
          await tx.booking.update({
            where: { id: bookingId },
            data: {
              status: BookingStatus.DEPOSIT_PAID,
              stripePaymentMethodId: paymentMethodId,
            },
          });
        });

        // Retrieve full booking information for Jobber creation and notification triggers
        const booking = await this.prisma.booking.findUnique({
          where: { id: bookingId },
          include: { customer: true, quote: true },
        });

        if (booking) {
          // Sync customer to Jobber
          let jobberCustomerId = booking.customer.jobberCustomerId;
          if (!jobberCustomerId) {
            jobberCustomerId = await this.jobberService.syncCustomer(
              `${booking.customer.firstName} ${booking.customer.lastName}`,
              booking.customer.email,
              booking.customer.phone,
              `${booking.customer.addressLine1 || ''} ${booking.customer.addressLine2 || ''}`.trim(),
            );

            await this.prisma.customer.update({
              where: { id: booking.customer.id },
              data: { jobberCustomerId },
            });
          }

          // Create moving job in Jobber
          const jobDetails = `
            Move details:
            - Client: ${booking.customer.firstName} ${booking.customer.lastName}
            - Phone: ${booking.customer.phone}
            - Moving Date: ${booking.requestedDate.toLocaleDateString()}
            - Quoted Cost: $${Number(booking.quote.estimatedTotal).toFixed(2)}
            - Inputs: ${JSON.stringify(booking.quote.rawInputs)}
          `;

          const jobberJobId = await this.jobberService.createJob(
            jobberCustomerId,
            `Phoenix Move - ${booking.customer.firstName} ${booking.customer.lastName}`,
            booking.requestedDate,
            jobDetails,
          );

          await this.prisma.booking.update({
            where: { id: bookingId },
            data: {
              jobberJobId,
              status: BookingStatus.SCHEDULED,
            },
          });

          // Trigger email receipts and text messages
          const depositPaid = Number(booking.depositAmount);

          await this.notificationsService.sendBookingConfirmation(
            booking.id,
            booking.customer.id,
            booking.customer.email,
            `${booking.customer.firstName} ${booking.customer.lastName}`,
            booking.requestedDate,
            Number(booking.quote.estimatedTotal),
            depositPaid,
          );

          await this.notificationsService.sendPaymentReceipt(
            booking.id,
            booking.customer.id,
            booking.customer.email,
            `${booking.customer.firstName} ${booking.customer.lastName}`,
            depositPaid,
            'DEPOSIT',
            intent.id,
          );

          await this.notificationsService.sendSmsConfirmation(
            booking.id,
            booking.customer.id,
            booking.customer.phone,
            `Hi ${booking.customer.firstName}, your move is scheduled for ${booking.requestedDate.toLocaleDateString()}. Deposit paid: $${depositPaid}. Thanks!`,
          );
        }

        // Mark webhook event as processed
        await this.prisma.webhookEvent.update({
          where: { id: webhookLog.id },
          data: { processed: true, processedAt: new Date() },
        });

      } catch (err: any) {
        this.logger.error(`Stripe Webhook processor error for Booking: ${bookingId}`, err.stack);
        await this.prisma.webhookEvent.update({
          where: { id: webhookLog.id },
          data: { processed: false, processingError: err.message },
        });
      }
    }

    return { received: true };
  }

  @Post('jobber-webhook')
  @ApiOperation({ summary: 'Jobber Webhook listener (manages job completions)' })
  @ApiResponse({ status: 200, description: 'Jobber webhook event processed' })
  async handleJobberWebhook(@Body() payload: any) {
    this.logger.log(`Ingesting Jobber Webhook: ${JSON.stringify(payload)}`);

    const topic = payload.topic || payload.event || '';
    const resourceId = payload.resourceId || payload.data?.id || '';
    const eventId = payload.id || `evt_jobber_${Date.now()}`;

    // 1. Idempotency Check: Prevent duplicate processing of the same Jobber event
    const existingWebhook = await this.prisma.webhookEvent.findUnique({
      where: {
        source_externalId: {
          source: WebhookSource.JOBBER,
          externalId: eventId,
        },
      },
    });

    if (existingWebhook) {
      this.logger.warn(`Jobber Event ID ${eventId} already processed. Skipping.`);
      return { received: true, duplicate: true };
    }

    // 2. Create Audit log
    const webhookLog = await this.prisma.webhookEvent.create({
      data: {
        source: WebhookSource.JOBBER,
        eventType: topic,
        externalId: eventId,
        payload,
        processed: false,
      },
    });

    // If job completion signal
    if (topic === 'JOB_COMPLETED' || topic === 'job_complete' || topic === 'job.complete') {
      try {
        const result = await this.bookingsService.completeJobAndCollectBalance(resourceId);
        
        await this.prisma.webhookEvent.update({
          where: { id: webhookLog.id },
          data: {
            processed: true,
            processedAt: new Date(),
          },
        });

        return { processed: true, result };
      } catch (error: any) {
        this.logger.error(`Failed to process Jobber webhook for Job ID: ${resourceId}`, error.stack);
        await this.prisma.webhookEvent.update({
          where: { id: webhookLog.id },
          data: {
            processed: false,
            processingError: error.message,
          },
        });
        return { processed: false, error: error.message };
      }
    }

    return { received: true };
  }
}
