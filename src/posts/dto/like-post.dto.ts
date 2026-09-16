import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LikePostDto {
  @ApiPropertyOptional({ enum: ['like', 'unlike'], default: 'like' })
  @IsIn(['like', 'unlike'])
  @IsOptional()
  action?: 'like' | 'unlike' = 'like';
}
