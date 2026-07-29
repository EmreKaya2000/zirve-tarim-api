import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { CustomerAccountProfile, CustomerProfileUpdateResponse } from '@zirve/types';

import { getRequestContext } from '../../common/utils/request-context';
import { CustomerAuth } from '../auth/decorators/customer-auth.decorator';

import { CustomerAuthService } from './customer-auth.service';
import { CurrentCustomer } from './decorators/current-customer.decorator';
import { UpdateCustomerProfileDto } from './dto/customer-auth.dto';

/**
 * Profil güncelleme e-posta gönderimi tetikleyebildiği için sınırlanır:
 * saatte 10 güncelleme, gerçek kullanımın çok üstünde ama posta kutusunu
 * doldurmaya yetmez.
 */
const PROFILE_UPDATE_THROTTLE = { default: { limit: 10, ttl: 3_600_000 } };

/**
 * Müşteri profili — Sprint 11 şartı 4.
 *
 * `/customer-auth/me` ile ÇAKIŞMAZ, birbirini tamamlar: `me` oturumun kim
 * olduğunu söyler (istemci açılışta çağırır), bu uç ise profil sayfasının
 * okuma/yazma noktasıdır. Ayrı denetleyicide durması, `/customer/*` adres
 * alanının tamamının müşteri verisi olması sözleşmesini korur.
 */
@ApiTags('Müşteri — Profil')
@ApiBearerAuth('customer-token')
@CustomerAuth()
@Controller('customer/profile')
export class CustomerProfileController {
  constructor(private readonly service: CustomerAuthService) {}

  @Get()
  @ApiOperation({
    summary: 'Profili getir',
    description:
      "Bağlı müşteri kartının varlığı yalnız `hasLinkedCustomer` boolean'ı olarak döner; " +
      'müşteri kodu, borç ve kredi limiti public tarafa SIZMAZ (Kural 8).',
  })
  async get(@CurrentCustomer('id') accountId: string): Promise<CustomerAccountProfile> {
    return this.service.getProfile(accountId);
  }

  @Patch()
  @Throttle(PROFILE_UPDATE_THROTTLE)
  @ApiOperation({
    summary: 'Profili güncelle',
    description: [
      'Ad, soyad ve telefon ANINDA güncellenir.',
      '',
      '**E-POSTA DEĞİŞİKLİĞİ YENİDEN DOĞRULAMA GEREKTİRİR**: yeni adrese',
      'bağlantı gönderilir ve adres ancak bağlantı açıldığında değişir. Yanıtta',
      '`pendingEmail` alanı bekleyen adresi taşır.',
      '',
      'Gerekçe: giriş anahtarı e-postadır ve şifre sıfırlama bağlantısı da oraya',
      'gider. Yanlış yazılmış bir adres anında uygulanırsa hesap kalıcı olarak',
      'erişilemez hâle gelirdi.',
    ].join('\n'),
  })
  async update(
    @CurrentCustomer('id') accountId: string,
    @Body() dto: UpdateCustomerProfileDto,
    @Req() request: Request,
  ): Promise<CustomerProfileUpdateResponse> {
    return this.service.updateProfile(accountId, dto, getRequestContext(request));
  }
}
