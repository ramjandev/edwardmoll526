import { ApiProperty } from '@nestjs/swagger';

class AdminMetricsDto {
  @ApiProperty({ example: 48, description: 'Total number of bookings created' })
  totalBookings!: number;

  @ApiProperty({ example: 12, description: 'Number of upcoming moving jobs' })
  upcomingBookings!: number;

  @ApiProperty({ example: 35, description: 'Number of distinct customers in database' })
  activeCustomers!: number;

  @ApiProperty({ example: 14250.00, description: 'Net revenue (deposits + balances - refunds)' })
  totalRevenue!: number;

  @ApiProperty({ example: 4500.00, description: 'Sum of all collected deposits' })
  depositsCollected!: number;

  @ApiProperty({ example: 10250.00, description: 'Sum of all collected balances' })
  balancesCollected!: number;

  @ApiProperty({ example: 500.00, description: 'Sum of all processed refunds' })
  refundsProcessed!: number;

  @ApiProperty({ example: 2, description: 'Number of failed transaction attempts' })
  failedPaymentsCount!: number;
}

export class AdminStatsResponseDto {
  @ApiProperty({ type: AdminMetricsDto })
  metrics!: AdminMetricsDto;
}
