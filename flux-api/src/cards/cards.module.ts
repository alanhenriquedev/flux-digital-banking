import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { InvoicesController } from './invoices.controller';

@Module({
  controllers: [CardsController, InvoicesController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}