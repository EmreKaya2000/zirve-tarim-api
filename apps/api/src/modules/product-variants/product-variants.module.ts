import { Module } from '@nestjs/common';

import { ProductPricingModule } from '../products/product-pricing.module';
import { StockModule } from '../stock/stock.module';
import { ProductVariantsController } from './product-variants.controller';
import { ProductVariantsService } from './product-variants.service';

/**
 * `ProductsModule`u İÇE ALMAZ.
 *
 * Daha önce yalnız `ProductPricingService` için alıyordu. Ürün oluşturma artık
 * varyasyonları da aynı transaction'da yazdığından `ProductsModule` bu modüle
 * ihtiyaç duyuyor; eski bağ korunsaydı iki modül birbirini içe alır ve
 * `forwardRef` gerekirdi. Paylaşılan fiyatlama servisi kendi modülüne taşındı,
 * böylece bağımlılık tek yönlü kaldı.
 */
@Module({
  imports: [ProductPricingModule, StockModule],
  controllers: [ProductVariantsController],
  providers: [ProductVariantsService],
  exports: [ProductVariantsService],
})
export class ProductVariantsModule {}
