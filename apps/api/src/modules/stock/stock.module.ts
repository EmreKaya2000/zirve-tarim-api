import { Module } from '@nestjs/common';

import { StockController } from './stock.controller';
import { StockQueryService } from './stock-query.service';
import { StockService } from './stock.service';

/**
 * Stok modülü (Sprint 9).
 *
 * `StockService` DIŞARI AÇILIR: satış onayı/iptali ve varyasyon oluşturma
 * stoğu bu servis üzerinden değiştirir. Modül dışına açılan tek yazma yolu
 * budur — `product_variants.stockQuantity` başka hiçbir yerden UPDATE
 * edilmez (K-56).
 */
@Module({
  controllers: [StockController],
  providers: [StockService, StockQueryService],
  exports: [StockService],
})
export class StockModule {}
