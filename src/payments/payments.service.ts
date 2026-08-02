import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { PaymentType, PaymentStatus, BookingStatus } from '../generated/prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;
  private isMock = true;

  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    const stripeKey = configService.get<string>('STRIPE_SECRET_KEY');

    if (stripeKey && !stripeKey.includes('mock')) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2025-01-27.acacia' as any, // Use stable Stripe version
      });
      this.isMock = false;
      this.logger.log('Stripe SDK initialized successfully.');
    } else {
      this.logger.warn('Using Stripe Mock processor (no Stripe API secret key provided).');
    }
  }

  /**
   * Creates a Stripe PaymentIntent for the booking deposit (30%).
   * Automatically configures it to save the card for off-session charges (remaining 70%).
   */
  async createDepositIntent(bookingId: string): Promise<{
    paymentIntentId: string;
    clientSecret: string | null;
    amount: number;
    currency: string;
  }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        quote: true,
        customer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const depositAmount = Number(booking.depositAmount);
    this.logger.log(`Creating deposit intent for Booking: ${bookingId}. Amount: $${depositAmount}`);

    if (this.isMock) {
      const mockIntentId = `pi_mock_${Math.floor(Math.random() * 1000000)}`;
      
      // Upsert a pending payment record in our database
      await this.prisma.payment.upsert({
        where: { stripePaymentIntentId: mockIntentId },
        update: { amount: depositAmount },
        create: {
          bookingId: booking.id,
          stripePaymentIntentId: mockIntentId,
          amount: depositAmount,
          type: PaymentType.DEPOSIT,
          status: PaymentStatus.PROCESSING,
        },
      });

      return {
        paymentIntentId: mockIntentId,
        clientSecret: `pi_mock_client_secret_${mockIntentId}`,
        amount: depositAmount,
        currency: 'usd',
      };
    }

    try {
      // Create Stripe PaymentIntent
      const intent = await this.stripe!.paymentIntents.create({
        amount: Math.round(depositAmount * 100), // cents
        currency: 'usd',
        metadata: { bookingId: booking.id },
        setup_future_usage: 'off_session', // critical: allows us to charge remaining balance later
        receipt_email: booking.customer.email,
        description: `Phoenix Moving: Deposit for booking on ${booking.requestedDate.toLocaleDateString()}`,
      });

      // Save pending payment record
      await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          stripePaymentIntentId: intent.id,
          amount: depositAmount,
          type: PaymentType.DEPOSIT,
          status: PaymentStatus.REQUIRES_ACTION,
        },
      });

      return {
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amount: depositAmount,
        currency: 'usd',
      };
    } catch (error: any) {
      this.logger.error('Failed to create Stripe PaymentIntent', error.stack);
      throw new BadRequestException(`Stripe error: ${error.message}`);
    }
  }

  /**
   * Charges the remaining balance off-session using the saved payment method.
   */
  async chargeRemainingBalance(bookingId: string): Promise<string> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        quote: true,
        customer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Read saved payment method from Booking record directly
    const paymentMethodId = booking.stripePaymentMethodId;
    if (!paymentMethodId) {
      throw new BadRequestException(`No active saved payment method found for Booking ${bookingId} (requires successful deposit first)`);
    }

    const balanceAmount = Number(booking.balanceAmount);
    this.logger.log(`Charging remaining balance for Booking ${bookingId}: Amount: $${balanceAmount}`);

    if (this.isMock || paymentMethodId.includes('mock')) {
      const mockIntentId = `pi_mock_balance_${Math.floor(Math.random() * 1000000)}`;

      await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          stripePaymentIntentId: mockIntentId,
          amount: balanceAmount,
          type: PaymentType.BALANCE,
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
        },
      });

      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.BALANCE_PAID },
      });

      this.logger.log(`Mock remaining balance $${balanceAmount} charged successfully.`);
      return mockIntentId;
    }

    try {
      // Charge the card off-session (requires confirm: true, off_session: true, and the payment_method ID)
      const intent = await this.stripe!.paymentIntents.create({
        amount: Math.round(balanceAmount * 100),
        currency: 'usd',
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Phoenix Moving: Final Balance for booking on ${booking.requestedDate.toLocaleDateString()}`,
        metadata: { bookingId: booking.id },
      });

      const isSucceeded = intent.status === 'succeeded';

      await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          stripePaymentIntentId: intent.id,
          amount: balanceAmount,
          type: PaymentType.BALANCE,
          status: isSucceeded ? PaymentStatus.SUCCEEDED : PaymentStatus.PROCESSING,
          paidAt: isSucceeded ? new Date() : null,
        },
      });

      if (isSucceeded) {
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: { status: BookingStatus.BALANCE_PAID },
        });
        this.logger.log(`Stripe remaining balance charge of $${balanceAmount} succeeded.`);
      } else {
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: { status: BookingStatus.BALANCE_PENDING },
        });
        this.logger.error(`Stripe off-session charge did not complete instantly. Status: ${intent.status}`);
      }

      return intent.id;
    } catch (error: any) {
      this.logger.error(`Stripe off-session balance charge failed for Booking ${bookingId}`, error.stack);
      
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.BALANCE_PENDING },
      });

      // Log the failed payment attempt
      await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          stripePaymentIntentId: `pi_failed_${Date.now()}`,
          amount: balanceAmount,
          type: PaymentType.BALANCE,
          status: PaymentStatus.FAILED,
          failureReason: error.message,
        },
      });

      throw new BadRequestException(`Stripe Off-Session Charge Failed: ${error.message}`);
    }
  }

  /**
   * Helper to construct and verify a Stripe Webhook Event signature.
   */
  constructWebhookEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
    if (this.isMock) {
      const mockPayload = JSON.parse(rawBody);
      return mockPayload as Stripe.Event;
    }
    return this.stripe!.webhooks.constructEvent(rawBody, signature, secret);
  }

  /**
   * Refunds a successful Stripe charge.
   */
  async refundPayment(paymentId: string): Promise<any> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('Only successful payments can be refunded');
    }

    this.logger.log(`Initiating refund for Payment: ${paymentId}, Intent: ${payment.stripePaymentIntentId}`);

    if (this.isMock) {
      // Mark old payment status as cancelled, and insert a REFUND entry for proper audit ledger history
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.CANCELLED },
      });

      await this.prisma.payment.create({
        data: {
          bookingId: payment.bookingId,
          type: PaymentType.REFUND,
          status: PaymentStatus.SUCCEEDED,
          amount: payment.amount,
          stripeRefundId: `ref_mock_${Math.floor(Math.random() * 1000000)}`,
          paidAt: new Date(),
        },
      });

      await this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: BookingStatus.REFUNDED },
      });

      return { refunded: true, id: payment.stripePaymentIntentId, mock: true };
    }

    try {
      const refund = await this.stripe!.refunds.create({
        payment_intent: payment.stripePaymentIntentId || undefined,
      });

      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.CANCELLED },
      });

      // Create refund audit record
      await this.prisma.payment.create({
        data: {
          bookingId: payment.bookingId,
          type: PaymentType.REFUND,
          status: PaymentStatus.SUCCEEDED,
          amount: payment.amount,
          stripeRefundId: refund.id,
          paidAt: new Date(),
        },
      });

      await this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: BookingStatus.REFUNDED },
      });

      this.logger.log(`Refund successfully processed in Stripe for Payment: ${paymentId}`);
      return refund;
    } catch (error: any) {
      this.logger.error(`Stripe refund failed for Payment ${paymentId}`, error.stack);
      throw new BadRequestException(`Stripe refund failed: ${error.message}`);
    }
  }
}
