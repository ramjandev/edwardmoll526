import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [SheetsModule],
  providers: [QuotesService],
  controllers: [QuotesController],
  exports: [QuotesService],
})
export class QuotesModule {}
