import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/booking.dto';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingStatus } from '../../generated/prisma/client';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private readonly maxJobsPerDay = 2; // Prevent double booking by limiting daily schedule to 2 moves

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Reserves a pending slot for a move.
   * Validates date capacity before booking.
   */
  async createBooking(dto: CreateBookingDto) {
    this.logger.log(`Reserving booking for Quote: ${dto.quoteId} on Date: ${dto.movingDate}`);

    const quote = await this.prisma.quote.findUnique({
      where: { id: dto.quoteId },
      include: { customer: true },
    });

    if (!quote) {
      throw new NotFoundException(`Quote with ID ${dto.quoteId} not found`);
    }

    // 1. Prevent double booking: check capacity for requested day
    const requestedDate = new Date(dto.movingDate);
    const startOfDay = new Date(requestedDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(requestedDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const existingBookings = await this.prisma.booking.count({
      where: {
        requestedDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: {
          in: [BookingStatus.DEPOSIT_PAID, BookingStatus.SCHEDULED, BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS],
        },
      },
    });

    if (existingBookings >= this.maxJobsPerDay) {
      this.logger.warn(`Double-booking prevented. Date ${startOfDay.toLocaleDateString()} is fully booked.`);
      throw new BadRequestException('The selected moving date is fully booked. Please choose another date.');
    }

    // 2. Compute amounts
    const totalAmount = Number(quote.estimatedTotal);
    const depositPercentage = Number(process.env.DEPOSIT_PERCENTAGE) || 30;
    const depositAmount = parseFloat(((totalAmount * depositPercentage) / 100).toFixed(2));
    const balanceAmount = parseFloat((totalAmount - depositAmount).toFixed(2));

    // 3. Create the pending booking record
    const booking = await this.prisma.booking.create({
      data: {
        quoteId: quote.id,
        customerId: quote.customerId,
        requestedDate,
        status: BookingStatus.DEPOSIT_PENDING,
        depositAmount,
        balanceAmount,
        totalAmount,
      },
      include: {
        customer: true,
        quote: true,
      },
    });

    return {
      bookingId: booking.id,
      customer: booking.customer,
      requestedDate: booking.requestedDate,
      totalAmount: Number(booking.totalAmount),
      depositAmount: Number(booking.depositAmount),
      balanceAmount: Number(booking.balanceAmount),
      status: booking.status,
    };
  }

  /**
   * Finalizes the moving lifecycle:
   * Charges the remaining balance off-session on the saved payment method,
   * updates the booking status, and sends confirmation receipts.
   */
  async completeJobAndCollectBalance(jobberJobId: string) {
    this.logger.log(`Received job completed event from Jobber for Job ID: ${jobberJobId}`);

    const booking = await this.prisma.booking.findFirst({
      where: { jobberJobId },
      include: { customer: true, quote: true, payments: true },
    });

    if (!booking) {
      this.logger.error(`No Booking record found matching Jobber Job ID: ${jobberJobId}`);
      throw new NotFoundException(`Booking matching job ID ${jobberJobId} not found`);
    }

    if (booking.status === BookingStatus.BALANCE_PAID) {
      this.logger.warn(`Booking ${booking.id} is already paid in full.`);
      return { status: 'ALREADY_PAID' };
    }

    // Mark job as completed in database
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.COMPLETED },
    });

    try {
      // 1. Charge the remaining balance off-session
      const stripeIntentId = await this.paymentsService.chargeRemainingBalance(booking.id);

      // Find the successful balance payment we just created
      const balancePayment = await this.prisma.payment.findUnique({
        where: { stripePaymentIntentId: stripeIntentId },
      });

      const chargedAmount = balancePayment ? Number(balancePayment.amount) : Number(booking.balanceAmount);

      // 2. Send receipt notifications
      await this.notificationsService.sendPaymentReceipt(
        booking.id,
        booking.customer.id,
        booking.customer.email,
        `${booking.customer.firstName} ${booking.customer.lastName}`,
        chargedAmount,
        'BALANCE',
        stripeIntentId,
      );

      await this.notificationsService.sendSmsConfirmation(
        booking.id,
        booking.customer.id,
        booking.customer.phone,
        `Hi ${booking.customer.firstName}, your move is complete! The remaining balance of $${chargedAmount.toFixed(2)} has been successfully charged. Thank you for choosing us!`,
      );

      this.logger.log(`Remaining balance collected successfully for Booking: ${booking.id}`);
      return { status: 'SUCCESS', transactionId: stripeIntentId };
    } catch (chargeError: any) {
      this.logger.error(`Off-session balance collection failed for Booking: ${booking.id}`, chargeError.stack);

      // Mark the booking as BALANCE_PENDING to indicate they still owe the final payment
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.BALANCE_PENDING },
      });

      // Send alert SMS/email about the failed payment
      await this.notificationsService.sendSmsConfirmation(
        booking.id,
        booking.customer.id,
        booking.customer.phone,
        `Hi ${booking.customer.firstName}, we encountered an issue processing the remaining balance of your move. Please contact our support office to complete your payment.`,
      );

      return { status: 'CHARGE_FAILED', error: chargeError.message };
    }
  }

  /**
   * Retrieves bookings list for administration reports.
   */
  async getBookings() {
    return this.prisma.booking.findMany({
      include: {
        customer: true,
        quote: true,
        payments: true,
      },
      orderBy: {
        requestedDate: 'desc',
      },
    });
  }
}
