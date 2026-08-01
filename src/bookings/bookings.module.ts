import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PaymentsModule } from '../payments/payments.module';
import { JobberModule } from '../jobber/jobber.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PaymentsModule,
    JobberModule,
    NotificationsModule,
    AuthModule,
  ],
  providers: [BookingsService],
  controllers: [BookingsController],
  exports: [BookingsService],
})
export class BookingsModule {}
