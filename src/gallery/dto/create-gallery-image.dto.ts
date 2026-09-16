import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGalleryImageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
