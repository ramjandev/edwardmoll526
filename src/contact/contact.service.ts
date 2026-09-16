import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class ContactService {
  constructor(
    private prisma: PrismaService,
    private mailerService: MailerService,
  ) {}

  async create(dto: CreateInquiryDto) {
    const inquiry = await this.prisma.contactInquiry.create({
      data: dto,
    });

    // Send notification to admin in background
    this.mailerService.sendContactNotification(dto.name, dto.email, dto.phone || null, dto.message)
      .catch(err => console.error('Failed to send contact notification', err));

    // Send auto-reply to user in background
    this.mailerService.sendAutoReply(dto.email, dto.name)
      .catch(err => console.error('Failed to send auto-reply', err));

    return inquiry;
  }

  async findAll() {
    return this.prisma.contactInquiry.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(id: string) {
    const inquiry = await this.prisma.contactInquiry.findUnique({ where: { id } });
    if (!inquiry) {
      throw new NotFoundException(`Inquiry with ID ${id} not found`);
    }

    return this.prisma.contactInquiry.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
