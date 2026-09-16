import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    const [servicesCount, galleryCount, postsCount, unreadInquiriesCount] = await Promise.all([
      this.prisma.service.count(),
      this.prisma.galleryImage.count(),
      this.prisma.post.count(),
      this.prisma.contactInquiry.count({ where: { isRead: false } }),
    ]);

    return {
      servicesCount,
      galleryCount,
      postsCount,
      unreadInquiriesCount,
    };
  }
}
