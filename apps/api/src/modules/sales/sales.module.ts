import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module';
import { PaymentsModule } from '../payments/payments.module';
import { StockModule } from '../stock/stock.module';

import { SaleCalculationService } from './sale-calculation.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [CustomersModule, PaymentsModule, StockModule],
  controllers: [SalesController],
  providers: [SalesService, SaleCalculationService],
  exports: [SalesService, SaleCalculationService],
})
export class SalesModule {}
