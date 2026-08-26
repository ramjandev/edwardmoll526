import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { JobberModule } from '../jobber/jobber.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [JobberModule, AuthModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
