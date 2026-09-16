import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';

@Injectable()
export class GalleryService {
  constructor(private prisma: PrismaService) {}

  async findAll(category?: string) {
    return this.prisma.galleryImage.findMany({
      where: {
        isActive: true,
        ...(category ? { category } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(dto: CreateGalleryImageDto) {
    return this.prisma.galleryImage.create({
      data: dto,
    });
  }

  async update(id: string, dto: UpdateGalleryImageDto) {
    const image = await this.prisma.galleryImage.findUnique({ where: { id } });
    if (!image) {
      throw new NotFoundException(`Gallery image with ID ${id} not found`);
    }
    return this.prisma.galleryImage.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const image = await this.prisma.galleryImage.findUnique({ where: { id } });
    if (!image) {
      throw new NotFoundException(`Gallery image with ID ${id} not found`);
    }
    return this.prisma.galleryImage.delete({
      where: { id },
    });
  }
}
