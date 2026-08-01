import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { NotificationChannel } from '../generated/prisma/client';

export class SendNotificationDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3', description: 'The customer database ID' })
  @IsUUID()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty({ example: '9a8d8e7b-c6d5-4e3f-9128-e4b7b25a39c9', required: false, description: 'Optional booking database ID' })
  @IsUUID()
  @IsOptional()
  bookingId?: string;

  @ApiProperty({ enum: NotificationChannel, example: NotificationChannel.PUSH })
  @IsEnum(NotificationChannel)
  @IsNotEmpty()
  channel!: NotificationChannel;

  @ApiProperty({ example: 'invoice', description: 'Type of alert: invoice, receipt, otp, promotion, reminder' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ example: 'Payment Received', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ example: 'Thank you for your business. We have successfully received your deposit.' })
  @IsString()
  @IsNotEmpty()
  body!: string;
}

export class RegisterFcmTokenDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3', required: false })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ example: '2a8e8e7b-c6d5-4e3f-9128-e4b7b25a39a2', required: false })
  @IsUUID()
  @IsOptional()
  adminUserId?: string;

  @ApiProperty({ example: 'fcm_registration_token_string_here_123...' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
