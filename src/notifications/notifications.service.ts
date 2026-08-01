import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '../generated/prisma/client';
import * as nodemailer from 'nodemailer';
import { Twilio } from 'twilio';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { SendNotificationDto, RegisterFcmTokenDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  
  // SMTP Transport
  private mailTransporter?: nodemailer.Transporter;
  private emailFrom = 'no-reply@movingphoenix.com';
  
  // Twilio Client
  private twilioClient?: Twilio;
  private twilioPhone?: string;

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
    const smtpPort = this.configService.get<number>('SMTP_PORT') || 587;
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.emailFrom = this.configService.get<string>('EMAIL_FROM') || 'no-reply@movingphoenix.com';

    if (smtpHost && smtpUser && smtpPass) {
      this.mailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
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
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioPhone = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (accountSid && authToken && this.twilioPhone) {
      this.twilioClient = new Twilio(accountSid, authToken);
      this.logger.log('Twilio SMS Client initialized successfully.');
    } else {
      this.logger.warn('Twilio credentials missing. SMS alerts will run in sandbox/mock mode.');
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

  private async sendSMS(to: string, body: string): Promise<string> {
    if (this.twilioClient && this.twilioPhone) {
      const message = await this.twilioClient.messages.create({
        from: this.twilioPhone,
        to,
        body,
      });
      return message.sid;
    } else {
      this.logger.log(`[TWILIO MOCK SMS] To: ${to} | Body: ${body}`);
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
    paymentIntentId: string,
  ) {
    const emailSubject = `Payment Receipt - ${type} Received`;
    const emailBody = `Dear ${customerName},\n\nPayment Successful!\n\nType: ${type}\nAmount: $${amount.toFixed(2)}\nTransaction: ${paymentIntentId}\n\nPhoenix Moving Team`;

    await this.dispatchNotification({
      customerId,
      bookingId,
      channel: NotificationChannel.EMAIL,
      type: type === 'DEPOSIT' ? 'deposit_receipt' : 'balance_receipt',
      title: emailSubject,
      body: emailBody,
    });
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
}
