import { Module } from '@nestjs/common';

import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * Sunucu tarafı sepet modülü (Sprint 11).
 *
 * InquiriesModule'e BAĞIMLI DEĞİLDİR: ortak olan miktar kuralları
 * `common/utils/quantity-rules.ts` içindedir ve her iki modül oradan okur.
 * Modül bağımlılığı kurulsaydı sepet, talep numarası üretimi ve satışa
 * dönüştürme gibi hiç ihtiyaç duymadığı servisleri de yüklerdi.
 */
@Module({
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
