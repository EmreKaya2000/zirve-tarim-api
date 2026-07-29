import { Module } from '@nestjs/common';

import { ProductPricingService } from './product-pricing.service';

/**
 * Fiyat türetme servisi için ayrı modül.
 *
 * NEDEN AYRI: `ProductPricingService` hem `ProductsService` hem
 * `ProductVariantsService` tarafından kullanılır. Tek bir `ProductsModule`
 * içinde dursaydı, ürün oluşturmanın varyasyon yazabilmesi için gereken
 * `ProductsModule -> ProductVariantsModule -> ProductsModule` DÖNGÜSÜ
 * kaçınılmaz olurdu (`forwardRef` gerektirirdi).
 *
 * Paylaşılan yaprak bağımlılığı kendi modülüne almak döngüyü kaynağında
 * keser: her iki modül de bunu içe alır, birbirini içe almaz.
 */
@Module({
  providers: [ProductPricingService],
  exports: [ProductPricingService],
})
export class ProductPricingModule {}
