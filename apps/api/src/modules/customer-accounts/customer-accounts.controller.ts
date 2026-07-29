import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

import { CustomerAccountsService } from './customer-accounts.service';
import { CustomerAccountQueryDto, LinkCustomerAccountDto } from './dto/customer-account-admin.dto';

/**
 * Müşteri hesaplarının yönetimi (admin) — Sprint 11 şartı 5.
 *
 * KAPSAM DAR VE BİLİNÇLİDİR: yönetici hesap OLUŞTURAMAZ, ŞİFRE
 * SIFIRLAYAMAZ, E-POSTA DEĞİŞTİREMEZ ve hesap SİLEMEZ. Tek yetkisi, hesabı
 * bir CRM müşteri kartına bağlamak veya bağı kaldırmaktır.
 *
 * Gerekçe: bu işlemler hesabın SAHİBİNE aittir. Yöneticiye açılırsa,
 * telefonla arayıp "ben Ahmet Yılmaz, şifremi sıfırlar mısınız" diyen birinin
 * ikna kabiliyeti hesap devralma yetkisine dönüşür. Kullanıcı kendi
 * "şifremi unuttum" akışını kullanır.
 */
@ApiTags('Müşteri Hesapları')
@ApiBearerAuth('access-token')
@Controller('admin/customer-accounts')
export class CustomerAccountsController {
  constructor(private readonly service: CustomerAccountsService) {}

  @Get()
  @ApiOperation({
    summary: 'Müşteri hesaplarını listele',
    description:
      'Arama: e-posta, ad, soyad, telefon. `linked=false` filtresi, bir CRM kartına ' +
      'henüz bağlanmamış hesapları verir — yöneticinin eşleştirme yapması gereken liste.',
  })
  async findMany(@Query() query: CustomerAccountQueryDto) {
    return this.service.findMany(query);
  }

  /**
   * `:id` ROTASINDAN ÖNCE tanımlanmalıdır.
   *
   * NestJS rotaları tanım sırasına göre eşler; aşağıda kalsaydı
   * `/suggestions` önce `@Get(':id')` ile eşleşir ve `ParseUUIDPipe`
   * "geçersiz kimlik" hatası verirdi.
   */
  @Get('suggestions/:customerId')
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiOperation({
    summary: 'Bir müşteri kartı için hesap adayları',
    description: [
      'Telefon veya e-posta eşleşen, HENÜZ BAĞLANMAMIŞ hesapları önerir.',
      '',
      '**YALNIZ ÖNERİDİR — otomatik bağlama YAPILMAZ.** Telefon numarası bu',
      'sistemde doğrulanmıyor (SMS akışı yok); numarayı bilen biri otomatik',
      'olarak bağlanırsa o müşterinin talep geçmişini okuyabilirdi. Kararı',
      'kişiyi tanıyan mağaza verir.',
    ].join('\n'),
  })
  async suggestions(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.service.suggestForCustomer(customerId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Hesap detayı',
    description:
      'Bağlı müşteri kartı ve gönderdiği talep sayısı. Şifre ve kilit bilgileri ' +
      'BU YANITTA YOKTUR — yöneticinin görmesi gereken veriler değil.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/link')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Hesabı müşteri kartına bağla / bağı kaldır',
    description: [
      '`customerId` verilirse bağ kurulur, `null` verilirse KALDIRILIR.',
      '',
      'Bağ kurulduğunda müşterinin satış ve borç geçmişi kaybolmaz: geçmiş',
      'kartta durur, hesap yalnız o karta işaret eder. Bu, kimlik alanlarının',
      '`customers` tablosuna EKLENMEME kararının asıl kazancıdır',
      '(bkz. schema.prisma "MÜŞTERİ HESABI" bölümü).',
      '',
      '**1↔1 KARDİNALİTE**: bir hesap en fazla bir karta, bir kart en fazla bir',
      'hesaba bağlanır. Çakışmada `ACCOUNT_LINK_CONFLICT` döner.',
      '',
      'İşlem denetim kaydına `ACCOUNT_LINKED` olarak yazılır.',
    ].join('\n'),
  })
  async link(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkCustomerAccountDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.link(id, dto.customerId ?? null, toActor(user, request));
  }
}
