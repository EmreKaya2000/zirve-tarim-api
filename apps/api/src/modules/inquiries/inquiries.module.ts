import { Module } from '@nestjs/common';

import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { SaleCalculationService } from '../sales/sale-calculation.service';
import { SettingsModule } from '../settings/settings.module';

import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { InquiryConversionService } from './inquiry-conversion.service';
import { InquiryValidationService } from './inquiry-validation.service';
import { PublicInquiriesController } from './public-inquiries.controller';

/**
 * Talep modülü.
 *
 * `SaleCalculationService` doğrudan sağlanır; SalesModule'ü import etmek
 * döngü üretirdi (SalesModule ileride talep verisine erişebilir).
 * Servis durumsuz olduğu için ayrı örnek sorun değildir.
 *
 * `CustomerAuthModule` (Sprint 11) yalnız `CustomerContextService` için
 * import edilir: public talep ucu, giriş yapmış bir müşteriyi isteğe bağlı
 * olarak tanıyıp talebi hesabına bağlar. Ters yönde bağımlılık YOKTUR —
 * müşteri kimliği talep modülünü bilmez.
 */
@Module({
  imports: [SettingsModule, CustomerAuthModule],
  controllers: [PublicInquiriesController, InquiriesController],
  providers: [
    InquiriesService,
    InquiryValidationService,
    InquiryConversionService,
    SaleCalculationService,
  ],
  exports: [InquiriesService],
})
export class InquiriesModule {}
