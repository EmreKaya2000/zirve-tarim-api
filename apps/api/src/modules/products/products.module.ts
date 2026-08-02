import { Module } from '@nestjs/common';

import { CategoriesModule } from '../categories/categories.module';
import { ProductVariantsModule } from '../product-variants/product-variants.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ProductPricingModule } from './product-pricing.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductImportService } from './product-import.service';

/**
 * `ProductVariantsModule` içe alınır: ürün oluşturma, varyasyonları ürünle
 * AYNI transaction'da yazabilmek için varyasyon servisine ihtiyaç duyar.
 *
 * `ProductPricingModule` yeniden dışa aktarılır: `ProductPricingService`
 * eskiden doğrudan bu modülden ihraç ediliyordu, onu bu yoldan bekleyen
 * modüller kırılmasın.
 */
@Module({
  imports: [CategoriesModule, ProductPricingModule, ProductVariantsModule, UploadsModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductImportService],
  exports: [ProductsService, ProductPricingModule],
})
export class ProductsModule {}
