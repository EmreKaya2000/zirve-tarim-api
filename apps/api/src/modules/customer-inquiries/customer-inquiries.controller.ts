import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { CustomerInquiryDetail, CustomerInquiryListItem, PaginatedResult } from '@zirve/types';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CustomerAuth } from '../auth/decorators/customer-auth.decorator';
import { CurrentCustomer } from '../customer-auth/decorators/current-customer.decorator';

import { CustomerInquiriesService } from './customer-inquiries.service';
import { InquiryNumberParamDto } from './dto/customer-inquiry.dto';

/**
 * "Taleplerim" — Sprint 11 şartı 3.
 *
 * Talep OLUŞTURMA burada değildir: o, misafirle ortak olan
 * `POST /public/inquiries` ucudur ve giriş yapmış kullanıcıyı jetonundan
 * tanıyıp talebi otomatik olarak hesaba bağlar. İki ayrı oluşturma ucu
 * olsaydı doğrulama kuralları iki yerde yaşardı.
 */
@ApiTags('Müşteri — Taleplerim')
@ApiBearerAuth('customer-token')
@CustomerAuth()
@Controller('customer/inquiries')
export class CustomerInquiriesController {
  constructor(private readonly service: CustomerInquiriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Taleplerimi listele',
    description: [
      'Yalnız oturum açmış hesaba BAĞLI talepler döner. Sayfalı; en yeni önce.',
      '',
      'Her satır: talep numarası, tarih, durum, kalem sayısı ve tahmini tutar.',
      '',
      'Misafirken gönderilmiş talepler, e-posta DOĞRULANDIKTAN sonra bu listeye',
      'katılır (`POST /customer-auth/verify-email`).',
    ].join('\n'),
  })
  async findMany(
    @CurrentCustomer('id') accountId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<CustomerInquiryListItem>> {
    return this.service.findMany(accountId, query);
  }

  @Get(':inquiryNumber')
  @ApiParam({ name: 'inquiryNumber', example: 'TLP-2026-000042' })
  @ApiOperation({
    summary: 'Talep detayım',
    description: [
      'Kalemler (talep anındaki snapshot bilgileriyle) ve durum bilgisi.',
      '',
      '**BAŞKASININ TALEP NUMARASI 404 DÖNER, 403 DEĞİL.** 403 "bu numara var',
      'ama senin değil" demektir; numaralar sıralı üretildiği için bir',
      'saldırgan sayarak mağazanın kaç talep aldığını öğrenebilirdi.',
      '',
      'Yanıtta `internalNote`, `ipAddress`, `userAgent`, atanan personel ve',
      'CRM müşteri kartı BULUNMAZ (Kural 8).',
    ].join('\n'),
  })
  async findOne(
    @CurrentCustomer('id') accountId: string,
    @Param() params: InquiryNumberParamDto,
  ): Promise<CustomerInquiryDetail> {
    return this.service.findOne(accountId, params.inquiryNumber);
  }
}
