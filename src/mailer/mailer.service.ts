import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailerService.name);

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendContactNotification(name: string, email: string, phone: string | null, message: string) {
    const notificationEmail = this.configService.get<string>('NOTIFICATION_EMAIL');
    const fromEmail = this.configService.get<string>('EMAIL_FROM');

    if (!notificationEmail || !fromEmail) {
      this.logger.error('Missing NOTIFICATION_EMAIL or EMAIL_FROM environment variables');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"Website Contact Form" <${fromEmail}>`,
        to: notificationEmail,
        subject: `New Contact Inquiry from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\n\nMessage:\n${message}`,
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
               <p><strong>Message:</strong></p>
               <p>${message.replace(/\n/g, '<br>')}</p>`,
      });
      this.logger.log(`Contact notification sent to ${notificationEmail}`);
    } catch (error) {
      this.logger.error('Failed to send contact notification', error);
    }
  }

  async sendAutoReply(toEmail: string, name: string) {
    const fromEmail = this.configService.get<string>('EMAIL_FROM');

    if (!fromEmail) {
      this.logger.error('Missing EMAIL_FROM environment variable');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"AAAAAffordable Moving" <${fromEmail}>`,
        to: toEmail,
        subject: 'Thank you for your inquiry',
        text: `Hi ${name},\n\nThank you for contacting AAAAAffordable Moving! We have received your message and will get back to you as soon as possible.\n\nBest regards,\nThe AAAAAffordable Moving Team`,
        html: `<p>Hi ${name},</p>
               <p>Thank you for contacting AAAAAffordable Moving! We have received your message and will get back to you as soon as possible.</p>
               <p>Best regards,<br>The AAAAAffordable Moving Team</p>`,
      });
      this.logger.log(`Auto-reply sent to ${toEmail}`);
    } catch (error) {
      this.logger.error('Failed to send auto-reply', error);
    }
  }
}
