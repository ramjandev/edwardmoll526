import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './sheets/sheets.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { JobberModule } from './jobber/jobber.module';
import { PaymentsModule } from './payments/payments.module';
import { BookingsModule } from './bookings/bookings.module';
import { QuotesModule } from './quotes/quotes.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    SheetsModule,
    AuthModule,
    NotificationsModule,
    JobberModule,
    PaymentsModule,
    BookingsModule,
    QuotesModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
