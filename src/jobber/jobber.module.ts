import { Module } from '@nestjs/common';
import { JobberService } from './jobber.service';
import { JobberController } from './jobber.controller';

@Module({
  providers: [JobberService],
  controllers: [JobberController],
  exports: [JobberService],
})
export class JobberModule {}
