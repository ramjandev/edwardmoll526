import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PaymentsModule, AuthModule],
  controllers: [AdminController],
})
export class AdminModule {}
