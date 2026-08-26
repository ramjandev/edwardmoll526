import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobberService } from '../jobber/jobber.service';
import {
  PaymentType,
  PaymentStatus,
  PaymentMethod,
  BookingStatus,
} from '../generated/prisma/client';

export interface PaymentLink {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  paymentUrl: string | null;
  amount: number;
  currency: string;
  type: PaymentType;
  status: PaymentStatus;
}

/**
 * Card processing is handled entirely by Jobber Payments. This service never
 * touches card data: it creates Jobber invoices and hands the customer the
 * Client Hub link where Jobber collects the money.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private jobber: JobberService,
  ) {}

  /**
   * Makes sure the customer exists in Jobber, creating them on first use.
   */
  private async ensureJobberCustomer(customerId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    if (customer.jobberCustomerId) {
      return customer.jobberCustomerId;
    }

    const address = [customer.addressLine1, customer.addressLine2]
      .filter(Boolean)
      .join(' ')
      .trim();

    const jobberCustomerId = await this.jobber.syncCustomer(
      `${customer.firstName} ${customer.lastName}`,
      customer.email,
      customer.phone,
      address || null,
    );

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { jobberCustomerId },
    });

    return jobberCustomerId;
  }

  /**
   * Creates the deposit invoice in Jobber and returns the Client Hub payment link.
   * Safe to call twice — an existing unpaid deposit invoice is returned as is.
   */
  async createDepositInvoice(bookingId: string): Promise<PaymentLink> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, quote: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const existing = await this.prisma.payment.findFirst({
      where: { bookingId, type: PaymentType.DEPOSIT },
    });

    if (existing?.status === PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('The deposit for this booking is already paid.');
    }

    if (existing?.jobberInvoiceId) {
      this.logger.log(`Reusing existing deposit invoice for booking ${bookingId}`);
      return this.toPaymentLink(existing);
    }

    const jobberCustomerId = await this.ensureJobberCustomer(booking.customerId);
    const depositAmount = Number(booking.depositAmount);
    const movingDate = booking.requestedDate.toLocaleDateString();

    const invoice = await this.jobber.createInvoice(
      jobberCustomerId,
      `Moving deposit - ${movingDate}`,
      `Deposit for move on ${movingDate}`,
      depositAmount,
      `Deposit to reserve your moving date of ${movingDate}. Your remaining balance of $${Number(booking.balanceAmount).toFixed(2)} is invoiced after the move is complete.`,
    );

    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: PaymentType.DEPOSIT,
        status: PaymentStatus.AWAITING_PAYMENT,
        method: PaymentMethod.JOBBER_ONLINE,
        amount: depositAmount,
        jobberInvoiceId: invoice.id,
        jobberInvoiceNumber: invoice.invoiceNumber,
        clientHubUri: invoice.clientHubUri,
      },
    });

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.DEPOSIT_PENDING,
        depositInvoiceId: invoice.id,
        depositInvoiceUrl: invoice.clientHubUri,
      },
    });

    this.logger.log(`Deposit invoice ${invoice.id} created for booking ${bookingId}`);
    return this.toPaymentLink(payment);
  }

  /**
   * Creates the balance invoice once the move is finished.
   */
  async createBalanceInvoice(bookingId: string): Promise<PaymentLink> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const existing = await this.prisma.payment.findFirst({
      where: { bookingId, type: PaymentType.BALANCE },
    });

    if (existing?.status === PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('The balance for this booking is already paid.');
    }

    if (existing?.jobberInvoiceId) {
      this.logger.log(`Reusing existing balance invoice for booking ${bookingId}`);
      return this.toPaymentLink(existing);
    }

    const jobberCustomerId = await this.ensureJobberCustomer(booking.customerId);
    const balanceAmount = Number(booking.balanceAmount);
    const movingDate = booking.requestedDate.toLocaleDateString();

    const invoice = await this.jobber.createInvoice(
      jobberCustomerId,
      `Moving balance - ${movingDate}`,
      `Final balance for move on ${movingDate}`,
      balanceAmount,
      `Final balance for your completed move on ${movingDate}. Thank you for choosing us.`,
    );

    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: PaymentType.BALANCE,
        status: PaymentStatus.AWAITING_PAYMENT,
        method: PaymentMethod.JOBBER_ONLINE,
        amount: balanceAmount,
        jobberInvoiceId: invoice.id,
        jobberInvoiceNumber: invoice.invoiceNumber,
        clientHubUri: invoice.clientHubUri,
      },
    });

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.BALANCE_PENDING,
        balanceInvoiceId: invoice.id,
        balanceInvoiceUrl: invoice.clientHubUri,
      },
    });

    this.logger.log(`Balance invoice ${invoice.id} created for booking ${bookingId}`);
    return this.toPaymentLink(payment);
  }

  /**
   * Reconciles a local payment record against Jobber after an invoice webhook.
   * Returns the payment when it transitioned to paid, otherwise null.
   */
  async settleInvoiceIfPaid(invoiceId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { jobberInvoiceId: invoiceId },
      include: { booking: { include: { customer: true } } },
    });

    if (!payment) {
      this.logger.warn(`No local payment record matches Jobber invoice ${invoiceId}`);
      return null;
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.log(`Invoice ${invoiceId} already settled locally. Skipping.`);
      return null;
    }

    const invoice = await this.jobber.getInvoice(invoiceId);
    const isPaid = invoice.balance <= 0;

    if (!isPaid) {
      this.logger.log(
        `Invoice ${invoiceId} still has an outstanding balance of $${invoice.balance}.`,
      );
      return null;
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        jobberInvoiceNumber: invoice.invoiceNumber ?? payment.jobberInvoiceNumber,
      },
    });

    const nextStatus =
      payment.type === PaymentType.DEPOSIT
        ? BookingStatus.DEPOSIT_PAID
        : BookingStatus.BALANCE_PAID;

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: nextStatus },
    });

    this.logger.log(
      `Invoice ${invoiceId} paid in Jobber. Booking ${payment.bookingId} -> ${nextStatus}`,
    );

    return { payment: updated, booking: payment.booking, type: payment.type };
  }

  /**
   * Records money collected outside Jobber's online checkout (cash or check).
   */
  async recordOfflinePayment(
    bookingId: string,
    type: PaymentType,
    method: PaymentMethod = PaymentMethod.CASH,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const amount =
      type === PaymentType.DEPOSIT
        ? Number(booking.depositAmount)
        : Number(booking.balanceAmount);

    const existing = await this.prisma.payment.findFirst({
      where: { bookingId, type },
    });

    if (existing) {
      return this.prisma.payment.update({
        where: { id: existing.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          method,
          paidAt: new Date(),
        },
      });
    }

    return this.prisma.payment.create({
      data: {
        bookingId,
        type,
        method,
        status: PaymentStatus.SUCCEEDED,
        amount,
        paidAt: new Date(),
      },
    });
  }

  /**
   * Jobber Payments refunds are issued from the Jobber dashboard, not the API.
   * This records the refund locally so reporting stays accurate.
   */
  async recordRefund(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('Only successful payments can be refunded');
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.CANCELLED },
    });

    const refund = await this.prisma.payment.create({
      data: {
        bookingId: payment.bookingId,
        type: PaymentType.REFUND,
        method: payment.method,
        status: PaymentStatus.SUCCEEDED,
        amount: payment.amount,
        jobberInvoiceNumber: payment.jobberInvoiceNumber,
        paidAt: new Date(),
      },
    });

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: BookingStatus.REFUNDED },
    });

    this.logger.log(`Refund recorded for payment ${paymentId}`);

    return {
      refund,
      message:
        'Refund recorded. Issue the actual refund from the Jobber dashboard under Payments.',
    };
  }

  /**
   * Current payment state for a booking. The frontend polls this after sending
   * the customer to Jobber to pay.
   */
  async getBookingPaymentStatus(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const deposit = booking.payments.find((p) => p.type === PaymentType.DEPOSIT);
    const balance = booking.payments.find((p) => p.type === PaymentType.BALANCE);

    return {
      bookingId: booking.id,
      status: booking.status,
      depositPaid: deposit?.status === PaymentStatus.SUCCEEDED,
      balancePaid: balance?.status === PaymentStatus.SUCCEEDED,
      depositAmount: Number(booking.depositAmount),
      balanceAmount: Number(booking.balanceAmount),
      totalAmount: Number(booking.totalAmount),
      depositInvoiceUrl: booking.depositInvoiceUrl,
      balanceInvoiceUrl: booking.balanceInvoiceUrl,
    };
  }

  private toPaymentLink(payment: {
    id: string;
    jobberInvoiceId: string | null;
    jobberInvoiceNumber: string | null;
    clientHubUri: string | null;
    amount: any;
    currency: string;
    type: PaymentType;
    status: PaymentStatus;
  }): PaymentLink {
    return {
      paymentId: payment.id,
      invoiceId: payment.jobberInvoiceId || '',
      invoiceNumber: payment.jobberInvoiceNumber,
      paymentUrl: payment.clientHubUri,
      amount: Number(payment.amount),
      currency: payment.currency,
      type: payment.type,
      status: payment.status,
    };
  }
}
