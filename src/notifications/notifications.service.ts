import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '../../generated/prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private emailFrom = '';

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.emailFrom = configService.get<string>('EMAIL_FROM') || 'no-reply@movingphoenix.com';
    this.logger.log('Notifications Service initialized.');
  }

  async sendBookingConfirmation(
    bookingId: string,
    customerId: string,
    toEmail: string,
    customerName: string,
    movingDate: Date,
    quotePrice: number,
    depositAmount: number,
  ) {
    const formattedDate = new Date(movingDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const emailSubject = 'Phoenix Moving Company - Booking Confirmation';
    const emailBody = `
      Dear ${customerName},

      Your move has been successfully scheduled!
      
      Details:
      - Moving Date: ${formattedDate}
      - Total Estimated Cost: $${quotePrice.toFixed(2)}
      - Deposit Paid (30%): $${depositAmount.toFixed(2)}
      - Remaining Balance (70%): $${(quotePrice - depositAmount).toFixed(2)}

      We will manage the job details through Jobber. You will receive updates as the moving day approaches.
      The remaining balance will be charged automatically upon completion of the move.

      Best regards,
      The Moving Phoenix Team
    `;

    this.logger.log(`[EMAIL SEND] To: ${toEmail} | Subject: ${emailSubject}`);

    // Create database audit log for the notification
    await this.prisma.notification.create({
      data: {
        customerId,
        bookingId,
        channel: NotificationChannel.EMAIL,
        type: 'booking_confirmation',
        status: NotificationStatus.SENT,
        recipient: toEmail,
        subject: emailSubject,
        body: emailBody,
        sentAt: new Date(),
      },
    });
  }

  async sendPaymentReceipt(
    bookingId: string,
    customerId: string,
    toEmail: string,
    customerName: string,
    amount: number,
    type: 'DEPOSIT' | 'BALANCE',
    paymentIntentId: string,
  ) {
    const emailSubject = `Payment Receipt - ${type} Received`;
    const emailBody = `
      Dear ${customerName},

      Thank you for your payment. Here is your receipt:
      
      - Payment Type: ${type} Payment
      - Amount Charged: $${amount.toFixed(2)}
      - Transaction ID: ${paymentIntentId}
      - Status: Successful

      If you have any questions, feel free to reply to this email.

      Best regards,
      The Moving Phoenix Team
    `;

    this.logger.log(`[EMAIL SEND] To: ${toEmail} | Subject: ${emailSubject}`);

    // Create database audit log
    await this.prisma.notification.create({
      data: {
        customerId,
        bookingId,
        channel: NotificationChannel.EMAIL,
        type: type === 'DEPOSIT' ? 'deposit_receipt' : 'balance_receipt',
        status: NotificationStatus.SENT,
        recipient: toEmail,
        subject: emailSubject,
        body: emailBody,
        providerId: paymentIntentId,
        sentAt: new Date(),
      },
    });
  }

  async sendSmsConfirmation(
    bookingId: string,
    customerId: string,
    toPhone: string,
    message: string,
  ) {
    this.logger.log(`[SMS SEND] To: ${toPhone} | Message: ${message}`);

    // Create database audit log
    await this.prisma.notification.create({
      data: {
        customerId,
        bookingId,
        channel: NotificationChannel.SMS,
        type: 'reminder',
        status: NotificationStatus.SENT,
        recipient: toPhone,
        body: message,
        sentAt: new Date(),
      },
    });
  }
}
