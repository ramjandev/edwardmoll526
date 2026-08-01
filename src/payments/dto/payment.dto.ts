import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateDepositIntentDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3', description: 'The booking database ID' })
  @IsUUID()
  bookingId!: string;
}
