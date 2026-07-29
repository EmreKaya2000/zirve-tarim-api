import { Module } from '@nestjs/common';

import { SaleCalculationService } from '../sales/sale-calculation.service';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Ödeme modülü.
 *
 * `SaleCalculationService` BURADA sağlanır ve SalesModule'de de sağlanır;
 * ikisi de aynı sınıfın ayrı örneğini kullanır. Servis DURUMSUZDUR (saf
 * hesaplama + verilen transaction üzerinde çalışır), bu yüzden örnek
 * paylaşımı gerekmez. Alternatif olan çapraz modül bağımlılığı
 * (SalesModule <-> PaymentsModule) döngü üretirdi.
 */
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, SaleCalculationService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
