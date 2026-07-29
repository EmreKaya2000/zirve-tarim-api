import { Module } from '@nestjs/common';

import { BenefitsModule } from '../benefits/benefits.module';
import { BrandsModule } from '../brands/brands.module';
import { CategoriesModule } from '../categories/categories.module';
import { PlantsModule } from '../plants/plants.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { SideEffectsModule } from '../side-effects/side-effects.module';
import { SoilTypesModule } from '../soil-types/soil-types.module';
import { UnitTypesModule } from '../unit-types/unit-types.module';
import { UsagePeriodsModule } from '../usage-periods/usage-periods.module';
import { PublicCatalogController } from './public-catalog.controller';

/**
 * Public katalog uçları.
 *
 * Kendi servisi yoktur; taksonomi modüllerinin servislerini kullanır.
 * Ayrı bir modül olmasının nedeni public/admin ayrımını YOL düzeyinde
 * değil MODÜL düzeyinde de görünür kılmaktır — bir ucun yanlışlıkla
 * public tarafa eklenmesi burada göze çarpar.
 */
@Module({
  imports: [
    CategoriesModule,
    BrandsModule,
    PlantsModule,
    SoilTypesModule,
    BenefitsModule,
    SideEffectsModule,
    UsagePeriodsModule,
    UnitTypesModule,
    SettingsModule,
    ProductsModule,
  ],
  controllers: [PublicCatalogController],
})
export class PublicCatalogModule {}
