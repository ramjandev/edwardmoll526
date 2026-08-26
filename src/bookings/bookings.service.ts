import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/booking.dto';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobberService } from '../jobber/jobber.service';
import {
  BookingStatus,
  PaymentType,
  PaymentMethod,
} from '../generated/prisma/client';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private readonly maxJobsPerDay = 2; // Prevent double booking by limiting daily schedule to 2 moves

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
    private jobberService: JobberService,
  ) {}

  /**
   * Reserves a pending slot for a move and raises the deposit invoice in Jobber.
   * The date is only held once the customer pays that invoice.
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

    // Update customer and quote details with actual info if provided
    if (dto.email) {
      const emailLower = dto.email.toLowerCase();

      // Check if another customer already has this email to avoid conflict
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { email: emailLower },
      });

      if (existingCustomer && existingCustomer.id !== quote.customerId) {
        // Re-link quote to the existing customer instead of updating the anonymous one
        await this.prisma.quote.update({
          where: { id: quote.id },
          data: { customerId: existingCustomer.id },
        });
        (quote as any).customerId = existingCustomer.id;

        const updatedCust = await this.prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            firstName: dto.firstName || existingCustomer.firstName,
            lastName: dto.lastName || existingCustomer.lastName,
            phone: dto.phone || existingCustomer.phone,
            addressLine1: dto.addressLine1 || existingCustomer.addressLine1,
            addressLine2: dto.addressLine2 || existingCustomer.addressLine2,
            fcmToken: dto.fcmToken || existingCustomer.fcmToken,
          },
        });
        quote.customer = updatedCust;
      } else {
        const updatedCust = await this.prisma.customer.update({
          where: { id: quote.customerId },
          data: {
            firstName: dto.firstName || quote.customer.firstName,
            lastName: dto.lastName || quote.customer.lastName,
            email: emailLower,
            phone: dto.phone || quote.customer.phone,
            addressLine1: dto.addressLine1 || quote.customer.addressLine1,
            addressLine2: dto.addressLine2 || quote.customer.addressLine2,
            fcmToken: dto.fcmToken || quote.customer.fcmToken,
          },
        });
        quote.customer = updatedCust;
      }

      // Update rawInputs on the quote for logging consistency
      const updatedInputs = {
        ...(quote.rawInputs as any),
        firstName: dto.firstName || (quote.rawInputs as any).firstName,
        lastName: dto.lastName || (quote.rawInputs as any).lastName,
        addressLine1: dto.addressLine1 || (quote.rawInputs as any).addressLine1,
        addressLine2: dto.addressLine2 || (quote.rawInputs as any).addressLine2,
      };

      await this.prisma.quote.update({
        where: { id: quote.id },
        data: { rawInputs: updatedInputs },
      });
      quote.rawInputs = updatedInputs;
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
        status: BookingStatus.QUOTED,
        depositAmount,
        balanceAmount,
        totalAmount,
      },
      include: {
        customer: true,
        quote: true,
      },
    });

    // 4. Raise the deposit invoice in Jobber and send the customer its payment link.
    // A Jobber outage must not lose the booking, so failures are reported but not fatal.
    let paymentUrl: string | null = null;
    let invoiceError: string | null = null;

    try {
      const depositLink = await this.paymentsService.createDepositInvoice(booking.id);
      paymentUrl = depositLink.paymentUrl;

      await this.notificationsService.sendPaymentRequest(
        booking.id,
        booking.customerId,
        `${booking.customer.firstName} ${booking.customer.lastName}`,
        depositLink.amount,
        'DEPOSIT',
        depositLink.paymentUrl,
        booking.requestedDate,
      );
    } catch (error: any) {
      invoiceError = error.message;
      this.logger.error(
        `Deposit invoice could not be created for booking ${booking.id}`,
        error.stack,
      );
    }

    const finalBooking = await this.prisma.booking.findUnique({
      where: { id: booking.id },
    });

    return {
      bookingId: booking.id,
      customer: booking.customer,
      requestedDate: booking.requestedDate,
      totalAmount: Number(booking.totalAmount),
      depositAmount: Number(booking.depositAmount),
      balanceAmount: Number(booking.balanceAmount),
      status: finalBooking?.status ?? booking.status,
      paymentUrl,
      invoiceError,
    };
  }

  /**
   * Runs after Jobber confirms the deposit invoice was paid.
   * Schedules the job in Jobber and confirms the date with the customer.
   */
  async handleDepositPaid(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, quote: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (booking.jobberJobId) {
      this.logger.warn(`Booking ${bookingId} already has Jobber job ${booking.jobberJobId}. Skipping.`);
      return { status: 'ALREADY_SCHEDULED', jobberJobId: booking.jobberJobId };
    }

    const customerName = `${booking.customer.firstName} ${booking.customer.lastName}`;

    let jobberCustomerId = booking.customer.jobberCustomerId;
    if (!jobberCustomerId) {
      const address = [booking.customer.addressLine1, booking.customer.addressLine2]
        .filter(Boolean)
        .join(' ')
        .trim();

      jobberCustomerId = await this.jobberService.syncCustomer(
        customerName,
        booking.customer.email,
        booking.customer.phone,
        address || null,
      );

      await this.prisma.customer.update({
        where: { id: booking.customerId },
        data: { jobberCustomerId },
      });
    }

    const jobDetails = [
      'Move details:',
      `- Client: ${customerName}`,
      `- Phone: ${booking.customer.phone}`,
      `- Moving Date: ${booking.requestedDate.toLocaleDateString()}`,
      `- Quoted Cost: $${Number(booking.quote.estimatedTotal).toFixed(2)}`,
      `- Deposit Paid: $${Number(booking.depositAmount).toFixed(2)}`,
      `- Balance Due: $${Number(booking.balanceAmount).toFixed(2)}`,
      `- Inputs: ${JSON.stringify(booking.quote.rawInputs)}`,
    ].join('\n');

    const jobberJobId = await this.jobberService.createJob(
      jobberCustomerId,
      `Phoenix Move - ${customerName}`,
      booking.requestedDate,
      jobDetails,
    );

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.SCHEDULED,
        jobberJobId,
        confirmedDate: booking.requestedDate,
      },
    });

    await this.notificationsService.sendBookingConfirmation(
      booking.id,
      booking.customerId,
      booking.customer.email,
      customerName,
      booking.requestedDate,
      Number(booking.totalAmount),
      Number(booking.depositAmount),
    );

    await this.notificationsService.sendSmsConfirmation(
      booking.id,
      booking.customerId,
      booking.customer.phone,
      `Hi ${booking.customer.firstName}, your move is confirmed for ${booking.requestedDate.toLocaleDateString()}. Deposit received. Balance of $${Number(booking.balanceAmount).toFixed(2)} is due after the move.`,
    );

    await this.notificationsService.sendPushConfirmation(
      booking.id,
      booking.customerId,
      'Move Scheduled',
      `Your move is reserved for ${booking.requestedDate.toLocaleDateString()}. Deposit received.`,
    );

    this.logger.log(`Booking ${bookingId} scheduled in Jobber as job ${jobberJobId}`);
    return { status: 'SCHEDULED', jobberJobId };
  }

  /**
   * Runs after Jobber reports the job finished.
   * Raises the balance invoice and sends the customer its payment link.
   */
  async handleJobCompleted(jobberJobId: string) {
    this.logger.log(`Jobber reported job ${jobberJobId} completed`);

    const booking = await this.prisma.booking.findFirst({
      where: { jobberJobId },
      include: { customer: true, quote: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking matching job ID ${jobberJobId} not found`);
    }

    if (booking.status === BookingStatus.BALANCE_PAID) {
      this.logger.warn(`Booking ${booking.id} is already paid in full.`);
      return { status: 'ALREADY_PAID' };
    }

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.COMPLETED },
    });

    const balanceLink = await this.paymentsService.createBalanceInvoice(booking.id);

    await this.notificationsService.sendPaymentRequest(
      booking.id,
      booking.customerId,
      `${booking.customer.firstName} ${booking.customer.lastName}`,
      balanceLink.amount,
      'BALANCE',
      balanceLink.paymentUrl,
      booking.requestedDate,
    );

    this.logger.log(`Balance invoice ${balanceLink.invoiceId} issued for booking ${booking.id}`);

    return {
      status: 'BALANCE_INVOICED',
      invoiceId: balanceLink.invoiceId,
      paymentUrl: balanceLink.paymentUrl,
    };
  }

  /**
   * Sends the receipt after Jobber confirms an invoice was paid.
   */
  async sendPaidReceipt(bookingId: string, type: PaymentType, amount: number, reference: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });

    if (!booking) return;

    const customerName = `${booking.customer.firstName} ${booking.customer.lastName}`;

    await this.notificationsService.sendPaymentReceipt(
      booking.id,
      booking.customerId,
      booking.customer.email,
      customerName,
      amount,
      type === PaymentType.DEPOSIT ? 'DEPOSIT' : 'BALANCE',
      reference,
    );
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

  /**
   * Marks a move complete and records the balance as collected in person.
   */
  async completeOffline(bookingId: string, method: PaymentMethod = PaymentMethod.CASH) {
    this.logger.log(`Marking booking ${bookingId} complete with an offline payment`);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, quote: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (booking.status === BookingStatus.BALANCE_PAID) {
      return { message: 'Booking is already complete', booking };
    }

    await this.paymentsService.recordOfflinePayment(
      bookingId,
      PaymentType.BALANCE,
      method,
    );

    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.BALANCE_PAID },
    });

    const customerName = `${booking.customer.firstName} ${booking.customer.lastName}`;
    const balance = Number(booking.balanceAmount);

    await this.notificationsService.sendPaymentReceipt(
      booking.id,
      booking.customerId,
      booking.customer.email,
      customerName,
      balance,
      'BALANCE',
      `Collected offline (${method})`,
    );

    await this.notificationsService.sendSmsConfirmation(
      booking.id,
      booking.customerId,
      booking.customer.phone,
      `Hi ${booking.customer.firstName}, your move is complete. The balance of $${balance.toFixed(2)} was received. Thank you!`,
    );

    await this.notificationsService.sendPushConfirmation(
      booking.id,
      booking.customerId,
      'Move Completed',
      `Balance of $${balance.toFixed(2)} received. Thank you!`,
    );

    return {
      message: 'Booking successfully marked complete offline',
      booking: updatedBooking,
    };
  }
}
