import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../generated/prisma/client';

class CustomerDetailsDto {
  @ApiProperty({ example: '83a9c479-e976-49c8-9631-81c1439b20f3' })
  id!: string;

  @ApiProperty({ example: 'Edward' })
  firstName!: string;

  @ApiProperty({ example: 'Moll' })
  lastName!: string;

  @ApiProperty({ example: 'edward@example.com' })
  email!: string;

  @ApiProperty({ example: '(602) 555-0199' })
  phone!: string;

  @ApiProperty({ example: '123 Phoenix Way', required: false })
  addressLine1?: string;

  @ApiProperty({ example: 'Suite 4', required: false })
  addressLine2?: string;

  @ApiProperty({ example: 'Phoenix', required: false })
  city?: string;

  @ApiProperty({ example: 'AZ', required: false })
  state?: string;

  @ApiProperty({ example: '85001', required: false })
  zip?: string;
}

export class BookingResponseDto {
  @ApiProperty({ example: '9a8d8e7b-c6d5-4e3f-9128-e4b7b25a39c9', description: 'The reserved Booking ID' })
  bookingId!: string;

  @ApiProperty({ type: CustomerDetailsDto })
  customer!: CustomerDetailsDto;

  @ApiProperty({ example: '2026-08-24T09:00:00.000Z' })
  requestedDate!: Date;

  @ApiProperty({ example: 450.00 })
  totalAmount!: number;

  @ApiProperty({ example: 135.00 })
  depositAmount!: number;

  @ApiProperty({ example: 315.00 })
  balanceAmount!: number;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.DEPOSIT_PENDING })
  status!: BookingStatus;

  @ApiProperty({
    example: 'https://clienthub.getjobber.com/client_hubs/abc/invoices/999999',
    description: 'Jobber Client Hub link where the customer pays the deposit',
    nullable: true,
  })
  paymentUrl!: string | null;

  @ApiProperty({
    example: null,
    description: 'Set when the Jobber deposit invoice could not be created',
    nullable: true,
  })
  invoiceError!: string | null;
}

export class BookingResponseWrapperDto {
  @ApiProperty({ example: 201 })
  statusCode!: number;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Request processed successfully' })
  message!: string;

  @ApiProperty({ type: BookingResponseDto })
  data!: BookingResponseDto;
}

export class BookingListResponseWrapperDto {
  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Request processed successfully' })
  message!: string;

  @ApiProperty({ type: [BookingResponseDto] })
  data!: BookingResponseDto[];
}
