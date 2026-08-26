import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaymentMethod, PaymentType } from '../../generated/prisma/client';

export class CreateInvoiceDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3', description: 'The booking database ID' })
  @IsUUID()
  bookingId!: string;
}

export class RecordOfflinePaymentDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3', description: 'The booking database ID' })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.BALANCE })
  @IsEnum(PaymentType)
  type!: PaymentType;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH, required: false })
  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;
}
