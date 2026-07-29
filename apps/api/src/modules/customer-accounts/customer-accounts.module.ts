import { Module } from '@nestjs/common';

import { CustomerAccountsController } from './customer-accounts.controller';
import { CustomerAccountsService } from './customer-accounts.service';

/**
 * Müşteri hesaplarının YÖNETİM tarafı (Sprint 11).
 *
 * CustomerAuthModule'den ayrıdır: o modül vitrinin kimlik akışını
 * (kayıt, giriş, şifre) yürütür ve public uçlar sunar; bu modül yalnız
 * yöneticinin gördüğü `/admin/customer-accounts` uçlarını sunar. Tek modülde
 * birleştirilseydi bir dekoratör hatası public bir ucu yönetim verisine
 * açabilirdi.
 */
@Module({
  controllers: [CustomerAccountsController],
  providers: [CustomerAccountsService],
})
export class CustomerAccountsModule {}
