import { ApiProperty } from '@nestjs/swagger';

export class PaymentIntentResponseDto {
  @ApiProperty({ example: 'pi_3Mtw1S2eZvKYlo2C0pabc123', description: 'The Stripe PaymentIntent ID' })
  paymentIntentId!: string;

  @ApiProperty({ example: 'pi_3Mtw1S2eZvKYlo2C0pabc123_secret_xyz789', description: 'The Stripe Client Secret for card verification on frontend' })
  clientSecret!: string | null;

  @ApiProperty({ example: 135.00, description: 'The deposit amount charged' })
  amount!: number;

  @ApiProperty({ example: 'usd' })
  currency!: string;
}
