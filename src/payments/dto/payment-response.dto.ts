import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus, PaymentType } from '../../generated/prisma/client';

export class PaymentLinkResponseDto {
  @ApiProperty({ example: '7c1f2b64-1d3e-4d9a-9f21-0f0d2c4b5a11', description: 'Local payment record ID' })
  paymentId!: string;

  @ApiProperty({ example: 'Z2lkOi8vSm9iYmVyL0ludm9pY2UvOTk5OTk5', description: 'The Jobber invoice ID' })
  invoiceId!: string;

  @ApiProperty({ example: 'INV-2042', description: 'Human readable Jobber invoice number', nullable: true })
  invoiceNumber!: string | null;

  @ApiProperty({
    example: 'https://clienthub.getjobber.com/client_hubs/abc/invoices/999999',
    description: 'Jobber Client Hub link where the customer pays by card',
    nullable: true,
  })
  paymentUrl!: string | null;

  @ApiProperty({ example: 135.0 })
  amount!: number;

  @ApiProperty({ example: 'usd' })
  currency!: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.DEPOSIT })
  type!: PaymentType;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.AWAITING_PAYMENT })
  status!: PaymentStatus;
}

export class PaymentLinkResponseWrapperDto {
  @ApiProperty({ example: 201 })
  statusCode!: number;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Request processed successfully' })
  message!: string;

  @ApiProperty({ type: PaymentLinkResponseDto })
  data!: PaymentLinkResponseDto;
}

export class PaymentStatusResponseDto {
  @ApiProperty({ example: '9a8d8e7b-c6d5-4e3f-9128-e4b7b25a39c9' })
  bookingId!: string;

  @ApiProperty({ example: 'DEPOSIT_PENDING' })
  status!: string;

  @ApiProperty({ example: false })
  depositPaid!: boolean;

  @ApiProperty({ example: false })
  balancePaid!: boolean;

  @ApiProperty({ example: 135.0 })
  depositAmount!: number;

  @ApiProperty({ example: 315.0 })
  balanceAmount!: number;

  @ApiProperty({ example: 450.0 })
  totalAmount!: number;

  @ApiProperty({ nullable: true })
  depositInvoiceUrl!: string | null;

  @ApiProperty({ nullable: true })
  balanceInvoiceUrl!: string | null;
}

export class PaymentStatusResponseWrapperDto {
  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Request processed successfully' })
  message!: string;

  @ApiProperty({ type: PaymentStatusResponseDto })
  data!: PaymentStatusResponseDto;
}
