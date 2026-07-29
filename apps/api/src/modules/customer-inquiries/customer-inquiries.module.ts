import { Module } from '@nestjs/common';

import { CustomerInquiriesController } from './customer-inquiries.controller';
import { CustomerInquiriesService } from './customer-inquiries.service';

/**
 * "Taleplerim" modülü (Sprint 11).
 *
 * InquiriesModule'den AYRIDIR ve onu import ETMEZ. Aynı tabloyu okurlar ama
 * farklı sözleşmeleri vardır: yönetim tarafı iç notu ve IP'yi görür, müşteri
 * tarafı görmez. Tek modülde birleştirilseydi iki seçicinin karışması
 * (ör. yanlış sabit import edilmesi) yalnız bir yazım hatası uzaklıkta olurdu.
 */
@Module({
  controllers: [CustomerInquiriesController],
  providers: [CustomerInquiriesService],
})
export class CustomerInquiriesModule {}
