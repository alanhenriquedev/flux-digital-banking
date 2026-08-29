import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PixController } from './pix.controller';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [RiskModule],
  controllers: [TransactionsController, PixController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
