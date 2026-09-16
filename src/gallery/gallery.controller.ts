import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GalleryService } from './gallery.service';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Gallery')
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  @ApiOperation({ summary: 'Get active gallery images' })
  @ApiQuery({ name: 'category', required: false })
  findAll(@Query('category') category?: string) {
    return this.galleryService.findAll(category);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new gallery image entry (Admin only)' })
  create(@Body() dto: CreateGalleryImageDto) {
    return this.galleryService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a gallery image (Admin only)' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto) {
    return this.galleryService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a gallery image (Admin only)' })
  remove(@Param('id') id: string) {
    return this.galleryService.remove(id);
  }
}
