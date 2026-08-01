import { ApiProperty } from '@nestjs/swagger';

class CustomerSummaryDto {
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
}

export class QuoteResponseDto {
  @ApiProperty({ example: '32b35a8f-287c-4c6e-82d9-e9df259b19e2', description: 'The generated Quote ID' })
  quoteId!: string;

  @ApiProperty({ example: 450.00, description: 'The calculated total estimated cost' })
  estimatedTotal!: number;

  @ApiProperty({ type: CustomerSummaryDto })
  customer!: CustomerSummaryDto;

  @ApiProperty({ example: '2026-08-01T02:53:51.000Z' })
  createdAt!: Date;
}
