import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '../generated/prisma/client';
import * as nodemailer from 'nodemailer';
import { Telnyx } from 'telnyx';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { SendNotificationDto, RegisterFcmTokenDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  
  // SMTP Transport
  private mailTransporter?: nodemailer.Transporter;
  private emailFrom = 'no-reply@movingphoenix.com';
  
  // Telnyx Client
  private telnyxClient?: Telnyx;
  private telnyxPhone?: string;

  // Firebase Cloud Messaging (FCM)
  private fcmEnabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.initializeEmail();
    this.initializeSMS();
    this.initializeFCM();
  }

  private initializeEmail() {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    // ConfigService hands back the raw .env string, so this must be coerced
    // before the implicit-TLS comparison below.
    const smtpPort = Number(this.configService.get('SMTP_PORT')) || 587;
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.emailFrom = this.configService.get<string>('EMAIL_FROM') || 'no-reply@movingphoenix.com';

    if (smtpHost && smtpUser && smtpPass) {
      this.mailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      this.logger.log('Nodemailer SMTP Transporter initialized successfully.');
    } else {
      this.logger.warn('SMTP credentials missing. Email alerts will run in sandbox/mock mode.');
    }
  }

  private initializeSMS() {
    const apiKey = this.configService.get<string>('TELNYX_API_KEY');
    this.telnyxPhone = this.configService.get<string>('TELNYX_PHONE_NUMBER');

    const hasRealKey =
      !!apiKey &&
      !apiKey.includes('mock') &&
      !apiKey.includes('YOUR_TELNYX');

    if (hasRealKey && this.telnyxPhone && !this.telnyxPhone.includes('YOUR_TELNYX')) {
      this.telnyxClient = new Telnyx({ apiKey });
      this.logger.log('Telnyx SMS Client initialized successfully.');
    } else {
      this.logger.warn('Telnyx credentials missing or invalid. SMS alerts will run in sandbox/mock mode.');
    }
  }

  private initializeFCM() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (projectId && clientEmail && privateKey) {
      try {
        if (getApps().length === 0) {
          initializeApp({
            credential: cert({
              projectId,
              clientEmail,
              privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
          });
        }
        this.fcmEnabled = true;
        this.logger.log('Firebase Cloud Messaging (FCM) initialized successfully.');
      } catch (error: any) {
        this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
      }
    } else {
      this.logger.warn('Firebase Private Key credentials missing. Push notifications will run in sandbox/mock mode.');
    }
  }

  /**
   * General-purpose notification dispatcher
   */
  async dispatchNotification(dto: SendNotificationDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer) {
      throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
    }

    let recipient = '';
    let success = false;
    let errMessage: string | null = null;
    let providerId: string | null = null;

    try {
      if (dto.channel === NotificationChannel.EMAIL) {
        recipient = customer.email;
        const subject = dto.title || 'Phoenix Moving Update';
        providerId = await this.sendEmail(recipient, subject, dto.body);
        success = true;
      } else if (dto.channel === NotificationChannel.SMS) {
        recipient = customer.phone;
        providerId = await this.sendSMS(recipient, dto.body);
        success = true;
      } else if (dto.channel === NotificationChannel.PUSH) {
        recipient = customer.fcmToken || 'NO_DEVICE_TOKEN_REGISTERED';
        if (!customer.fcmToken) {
          throw new Error('Customer does not have a registered FCM Device Token.');
        }
        const title = dto.title || 'Phoenix Moving Notification';
        providerId = await this.sendPush(recipient, title, dto.body);
        success = true;
      }
    } catch (err: any) {
      this.logger.error(`Failed to send notification via ${dto.channel}`, err.stack);
      errMessage = err.message || 'Unknown transport failure';
    }

    // Save persistent log in database
    return this.prisma.notification.create({
      data: {
        customerId: dto.customerId,
        bookingId: dto.bookingId || null,
        channel: dto.channel,
        type: dto.type,
        status: success ? NotificationStatus.SENT : NotificationStatus.FAILED,
        recipient,
        subject: dto.title || null,
        body: dto.body,
        providerId,
        errorMessage: errMessage,
        sentAt: success ? new Date() : null,
      },
    });
  }

  /**
   * Register Device FCM token for Push Notifications
   */
  async registerFcmToken(dto: RegisterFcmTokenDto) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer) throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);

      return this.prisma.customer.update({
        where: { id: dto.customerId },
        data: { fcmToken: dto.token },
      });
    }

    if (dto.adminUserId) {
      const adminUser = await this.prisma.adminUser.findUnique({ where: { id: dto.adminUserId } });
      if (!adminUser) throw new BadRequestException(`AdminUser with ID ${dto.adminUserId} not found`);

      return this.prisma.adminUser.update({
        where: { id: dto.adminUserId },
        data: { fcmToken: dto.token },
      });
    }

    throw new BadRequestException('Must provide either customerId or adminUserId to register token');
  }

  // --- Transports ---

  private async sendEmail(to: string, subject: string, body: string): Promise<string> {
    if (this.mailTransporter) {
      const info = await this.mailTransporter.sendMail({
        from: this.emailFrom,
        to,
        subject,
        text: body,
      });
      return info.messageId;
    } else {
      this.logger.log(`[SMTP MOCK EMAIL] To: ${to} | Subject: ${subject} | Body: ${body}`);
      return `smtp_mock_${Math.floor(Math.random() * 1000000)}`;
    }
  }

  private formatE164(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');

    if (trimmed.startsWith('+')) {
      return `+${digits}`;
    }
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return digits ? `+${digits}` : trimmed;
  }

  private async sendSMS(to: string, body: string): Promise<string> {
    if (this.telnyxClient && this.telnyxPhone) {
      const response = await this.telnyxClient.messages.send({
        from: this.formatE164(this.telnyxPhone),
        to: this.formatE164(to),
        text: body,
      });
      return response.data?.id || `telnyx_${Date.now()}`;
    } else {
      this.logger.log(`[TELNYX MOCK SMS] To: ${to} | Body: ${body}`);
      return `sms_mock_${Math.floor(Math.random() * 1000000)}`;
    }
  }

  private async sendPush(token: string, title: string, body: string): Promise<string> {
    if (this.fcmEnabled) {
      const response = await getMessaging().send({
        token,
        notification: {
          title,
          body,
        },
      });
      return response;
    } else {
      this.logger.log(`[FCM MOCK PUSH] Token: ${token} | Title: ${title} | Body: ${body}`);
      return `fcm_mock_${Math.floor(Math.random() * 1000000)}`;
    }
  }

  // --- Shortcuts for Booking Workflow ---

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
    const emailBody = `Dear ${customerName},\n\nYour move has been scheduled!\n\nDate: ${formattedDate}\nEstimated: $${quotePrice.toFixed(2)}\nDeposit (30%): $${depositAmount.toFixed(2)}\nRemaining (70%): $${(quotePrice - depositAmount).toFixed(2)}\n\nThank you!\nPhoenix Moving Team`;

    await this.dispatchNotification({
      customerId,
      bookingId,
      channel: NotificationChannel.EMAIL,
      type: 'booking_confirmation',
      title: emailSubject,
      body: emailBody,
    });
  }

  async sendPaymentReceipt(
    bookingId: string,
    customerId: string,
    toEmail: string,
    customerName: string,
    amount: number,
    type: 'DEPOSIT' | 'BALANCE',
    invoiceReference: string,
  ) {
    const emailSubject = `Payment Receipt - ${type} Received`;
    const emailBody = `Dear ${customerName},\n\nPayment Successful!\n\nType: ${type}\nAmount: $${amount.toFixed(2)}\nInvoice: ${invoiceReference}\n\nPhoenix Moving Team`;

    await this.dispatchNotification({
      customerId,
      bookingId,
      channel: NotificationChannel.EMAIL,
      type: type === 'DEPOSIT' ? 'deposit_receipt' : 'balance_receipt',
      title: emailSubject,
      body: emailBody,
    });
  }

  /**
   * Sends the Jobber Client Hub payment link over every channel the customer
   * has. This is how money is now requested — the customer pays inside Jobber.
   */
  async sendPaymentRequest(
    bookingId: string,
    customerId: string,
    customerName: string,
    amount: number,
    type: 'DEPOSIT' | 'BALANCE',
    paymentUrl: string | null,
    movingDate: Date,
  ) {
    const formattedDate = new Date(movingDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const label = type === 'DEPOSIT' ? 'deposit' : 'final balance';
    const linkLine = paymentUrl
      ? `Pay securely here: ${paymentUrl}`
      : 'Your invoice is on its way from our office.';

    const emailSubject =
      type === 'DEPOSIT'
        ? 'Phoenix Moving Company - Reserve Your Date'
        : 'Phoenix Moving Company - Final Invoice';

    const emailBody =
      type === 'DEPOSIT'
        ? `Dear ${customerName},\n\nYour move is booked for ${formattedDate}.\n\nTo lock in this date, please pay your ${label} of $${amount.toFixed(2)}.\n\n${linkLine}\n\nYour date is held until the deposit is received.\n\nPhoenix Moving Team`
        : `Dear ${customerName},\n\nYour move on ${formattedDate} is complete. Thank you!\n\nYour ${label} of $${amount.toFixed(2)} is now due.\n\n${linkLine}\n\nPhoenix Moving Team`;

    await this.dispatchNotification({
      customerId,
      bookingId,
      channel: NotificationChannel.EMAIL,
      type: type === 'DEPOSIT' ? 'deposit_request' : 'balance_request',
      title: emailSubject,
      body: emailBody,
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (customer?.phone) {
      await this.sendSmsConfirmation(
        bookingId,
        customerId,
        customer.phone,
        `Hi ${customer.firstName}, your ${label} of $${amount.toFixed(2)} for the ${formattedDate} move is ready. ${linkLine}`,
      );
    }

    await this.sendPushConfirmation(
      bookingId,
      customerId,
      type === 'DEPOSIT' ? 'Reserve Your Moving Date' : 'Final Invoice Ready',
      `Your ${label} of $${amount.toFixed(2)} is ready to pay.`,
    );
  }

  async sendSmsConfirmation(
    bookingId: string,
    customerId: string,
    toPhone: string,
    message: string,
  ) {
    await this.dispatchNotification({
      customerId,
      bookingId,
      channel: NotificationChannel.SMS,
      type: 'reminder',
      body: message,
    });
  }

  async sendPushConfirmation(
    bookingId: string,
    customerId: string,
    title: string,
    body: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (customer && customer.fcmToken) {
      await this.dispatchNotification({
        customerId,
        bookingId,
        channel: NotificationChannel.PUSH,
        type: 'booking_alert',
        title,
        body,
      });
    } else {
      this.logger.warn(`Skip sending FCM Push: Customer ${customerId} has no registered FCM token.`);
    }
  }
}
