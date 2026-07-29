import { Module } from '@nestjs/common';

import { ReportsService } from './reports.service';

/**
 * Rapor sorguları modülü (Sprint 10).
 *
 * CONTROLLER'I YOKTUR — bilinçli. Uçların tamamı `/admin/finance` altında
 * toplandığı için (şartname şart 1-6) HTTP yüzeyi `FinanceModule`'de durur.
 * Bu modülün işi, ağır toplama sorgularını tek yerde tutmak ve ihtiyaç
 * duyan her modüle (dashboard, ileride e-posta özetleri) aynı hesabı
 * vermektir.
 */
@Module({
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
