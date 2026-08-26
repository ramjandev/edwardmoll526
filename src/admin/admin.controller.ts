import { Controller, Get, Post, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus, PaymentType } from '../generated/prisma/client';
import { AdminStatsResponseDto } from './dto/admin-stats-response.dto';

@ApiTags('Admin Controls')
@Controller('admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Retrieve dashboard metrics and financial statistics' })
  @ApiResponse({ status: 200, description: 'Stats payload retrieved successfully', type: AdminStatsResponseDto })
  async getStats() {
    this.logger.log('Retrieving admin metrics stats');

    const totalBookings = await this.prisma.booking.count();
    const upcomingBookings = await this.prisma.booking.count({
      where: { requestedDate: { gte: new Date() } },
    });

    const payments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCEEDED },
    });

    // Net revenue = deposits + balance payments - refunds
    const depositsCollected = payments
      .filter((p) => p.type === PaymentType.DEPOSIT)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const balancesCollected = payments
      .filter((p) => p.type === PaymentType.BALANCE)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const refundsProcessed = payments
      .filter((p) => p.type === PaymentType.REFUND)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalRevenue = depositsCollected + balancesCollected - refundsProcessed;
    const activeCustomers = await this.prisma.customer.count();

    const failedPayments = await this.prisma.payment.count({
      where: { status: PaymentStatus.FAILED },
    });

    return {
      metrics: {
        totalBookings,
        upcomingBookings,
        activeCustomers,
        totalRevenue,
        depositsCollected,
        balancesCollected,
        refundsProcessed,
        failedPaymentsCount: failedPayments,
      },
    };
  }

  @Get('payments')
  @ApiOperation({ summary: 'Retrieve all transaction and payment logs' })
  @ApiResponse({ status: 200, description: 'List of payments returned' })
  async getPayments() {
    return this.prisma.payment.findMany({
      include: {
        booking: {
          include: {
            customer: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  @Get('customers')
  @ApiOperation({ summary: 'Retrieve list of all customers and sync status' })
  @ApiResponse({ status: 200, description: 'List of customers returned' })
  async getCustomers() {
    return this.prisma.customer.findMany({
      include: {
        bookings: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  @Post('payments/:id/refund')
  @ApiOperation({
    summary: 'Record a refund for a payment (issue the actual refund in Jobber)',
  })
  @ApiResponse({ status: 200, description: 'Refund recorded successfully' })
  @ApiResponse({ status: 400, description: 'Payment cannot be refunded' })
  async refundPayment(@Param('id') id: string) {
    return this.paymentsService.recordRefund(id);
  }

  @Get('webhook-logs')
  @ApiOperation({ summary: 'Retrieve raw Jobber webhook events for auditing' })
  @ApiResponse({ status: 200, description: 'Audit logs returned' })
  async getWebhookLogs() {
    return this.prisma.webhookEvent.findMany({
      orderBy: {
        receivedAt: 'desc',
      },
      take: 50,
    });
  }
}
