import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Name of the person commenting' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  author: string;

  @ApiProperty({ description: 'Comment or reply text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: 'Parent comment ID if this is a reply' })
  @IsString()
  @IsOptional()
  parentId?: string;
}
