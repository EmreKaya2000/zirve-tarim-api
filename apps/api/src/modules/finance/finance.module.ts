import { Module } from '@nestjs/common';

import { ReportsModule } from '../reports/reports.module';

import { DashboardService } from './dashboard.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Finans ekranları: dashboard, alacaklar, vadesi geçenler ve raporlar. */
@Module({
  imports: [ReportsModule],
  controllers: [FinanceController],
  providers: [DashboardService, FinanceService],
  exports: [DashboardService],
})
export class FinanceModule {}
