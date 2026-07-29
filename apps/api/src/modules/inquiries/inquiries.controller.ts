import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

import { InquiriesService } from './inquiries.service';
import { InquiryConversionService } from './inquiry-conversion.service';
import { InquiryQueryDto, UpdateInquiryDto, UpdateInquiryStatusDto } from './dto/inquiry.dto';
import { ConvertInquiryDto } from './dto/inquiry-conversion.dto';

/**
 * Talep yönetimi (admin).
 *
 * Talep SİLME ucu BİLİNÇLİ OLARAK YOKTUR (Kural 4): talep kaydı ticari
 * geçmiştir ve silinmez. Geçersiz bir talep REJECTED durumuna alınır;
 * kayıt ve gerekçesi durur.
 */
@ApiTags('Talepler')
@ApiBearerAuth('access-token')
@Controller('admin/inquiries')
export class InquiriesController {
  constructor(
    private readonly service: InquiriesService,
    private readonly conversion: InquiryConversionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Talepleri listele',
    description:
      'Filtreler: durum (virgülle çoklu), tarih aralığı ve serbest arama ' +
      '(talep numarası, ad, telefon, e-posta, il).',
  })
  async findMany(@Query() query: InquiryQueryDto) {
    return this.service.findMany(query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Duruma göre talep sayıları',
    description: 'Liste sayfasındaki durum sekmelerinin rozetleri için.',
  })
  async counts(): Promise<Record<string, number>> {
    return this.service.countByStatus();
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Talep detayı',
    description: 'Kalemler (snapshot alanlarıyla), iletişim bilgileri ve durum geçmişi.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Talebi bir müşteriye / müşteri hesabına bağla',
    description: [
      'Talep formu müşteri kaydı olmayan bir ziyaretçi tarafından da',
      'doldurulabilir. Aynı kişinin müşteri kartı varsa talep ona bağlanır;',
      'böylece geçmiş tek yerde toplanır ve satışa dönüşümde mükerrer kart',
      'açılmaz.',
      '',
      '`customerId: null` bağı kaldırır. Satışa dönüşmüş talep değiştirilemez.',
      '',
      '**İKİ BAĞIMSIZ BAĞ VARDIR** (Sprint 11):',
      '- `customerId`        -> mağazanın CRM kartı (satış/borç geçmişi)',
      '- `customerAccountId` -> ziyaretçinin public giriş hesabı ("Taleplerim")',
      '',
      'İkisi aynı istekte de gönderilebilir; her biri ayrı denetim kaydı üretir.',
      'Hesap bağı, telefon eşleşmesiyle otomatik kurulMADIĞI için buradan elle',
      'kurulur (SMS doğrulaması yok — hesap ele geçirme riski).',
      '',
      'Talebin İÇERİĞİ bu uçtan düzenlenemez: talep müşterinin beyanıdır.',
    ].join('\n'),
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInquiryDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const actor = toActor(user, request);

    // Her alan YALNIZ gönderildiyse işlenir: `PATCH { customerId }` isteğinin
    // hesap bağını sessizce koparması, iki bağın bağımsız olduğu sözleşmesini
    // bozardı.
    if (dto.customerAccountId !== undefined) {
      await this.service.linkCustomerAccount(id, dto.customerAccountId, actor);
    }

    if (dto.customerId !== undefined) {
      return this.service.linkCustomer(id, dto.customerId, actor);
    }

    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Talep durumunu değiştir',
    description: [
      'Geçerli geçişler @zirve/types içindeki ALLOWED_INQUIRY_TRANSITIONS',
      'tablosundadır. Uç durumlardan (COMPLETED, CANCELLED, REJECTED,',
      'CONVERTED_TO_SALE) çıkış yoktur.',
      '',
      'CONVERTED_TO_SALE bu uçtan SET EDİLEMEZ: satışa dönüşüm, satış',
      'kaydıyla aynı transaction içinde yapılır (Sprint 8).',
      '',
      'REJECTED ve CANCELLED için `note` ZORUNLUDUR.',
    ].join('\n'),
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInquiryStatusDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.updateStatus(id, dto, toActor(user, request));
  }

  @Post(':id/convert-to-sale')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Talebi satışa dönüştür',
    description: [
      'TEK transaction içinde: müşteri seçilir veya oluşturulur, talep',
      'kalemleri satışa aktarılır (miktar/fiyat düzenlenebilir), TASLAK',
      'satış oluşur, talep CONVERTED_TO_SALE durumuna alınır ve',
      'sales.inquiryId bağlanır.',
      '',
      'İDEMPOTENT: bir talep en fazla bir satışa dönüşür. Eşzamanlı ikinci',
      'istek `sales.inquiryId` UNIQUE kısıtına takılır ve 409 alır — tek',
      'satış oluşur.',
      '',
      'Satış TASLAK doğar: onaylamak için POST /admin/sales/:id/finalize.',
    ].join('\n'),
  })
  async convertToSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertInquiryDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.conversion.convert(id, dto, toActor(user, request));
  }
}
