import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ERROR_CODES } from '@zirve/types';
import type {
  CustomerAccountProfile,
  CustomerLoginResponse,
  CustomerRegisterResponse,
  CustomerVerifyEmailResponse,
} from '@zirve/types';

import { getRequestContext } from '../../common/utils/request-context';
import { CustomerAuth } from '../auth/decorators/customer-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';

import { CustomerAuthService } from './customer-auth.service';
import { CurrentCustomer, type RequestCustomer } from './decorators/current-customer.decorator';
import {
  CustomerLoginDto,
  CustomerLogoutDto,
  CustomerRefreshTokenDto,
  CustomerRegisterDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/customer-auth.dto';

/**
 * HIZ SINIRLARI — Sprint 11 şartı 6 ("register/login/forgot-password sıkı").
 *
 * Sınırlar IP BAŞINADIR ve hesap başına kilitle (5 hatalı deneme -> 15 dakika)
 * birlikte iki katmanlı koruma oluşturur. Değerler vitrin trafiğine göre
 * seçildi: yönetim panelinden farklı olarak burada aynı IP'nin arkasında bir
 * köyün tamamı olabilir (paylaşımlı mobil ağ), bu yüzden yönetici girişindeki
 * 5/dk sınırı burada gerçek kullanıcıları engellerdi.
 */

/** Kayıt: saatte 5. Gerçek bir kullanıcı bir kez kayıt olur. */
const REGISTER_THROTTLE = { default: { limit: 5, ttl: 3_600_000 } };

/** Giriş: dakikada 10. Şifre denemesi asıl olarak hesap kilidiyle sınırlanır. */
const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Şifremi unuttum: saatte 3.
 *
 * EN SIKI SINIR BURADA: bu uç, isteyen herkesin başkasının posta kutusuna
 * e-posta göndertebildiği tek yerdir. Gevşek bırakılırsa bir adrese yüzlerce
 * e-posta yollanabilir (taciz) ve alan adımız spam listelerine düşer.
 */
const FORGOT_PASSWORD_THROTTLE = { default: { limit: 3, ttl: 3_600_000 } };

/** Sıfırlama: saatte 10. Jeton tahmini pratikte imkânsız (256 bit). */
const RESET_PASSWORD_THROTTLE = { default: { limit: 10, ttl: 3_600_000 } };

/** Doğrulama: saatte 20 — kullanıcı bağlantıya iki kez dokunabilir. */
const VERIFY_EMAIL_THROTTLE = { default: { limit: 20, ttl: 3_600_000 } };

/** Yenileme: dakikada 30. */
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/** Doğrulama e-postasını yeniden gönder: saatte 3 (aynı taciz gerekçesi). */
const RESEND_THROTTLE = { default: { limit: 3, ttl: 3_600_000 } };

/**
 * Müşteri (public) kimlik doğrulama uçları — Sprint 11.
 *
 * `@CustomerAuth()` denetleyici düzeyindedir: JwtAuthGuard ve RolesGuard bu
 * uçları atlar, CustomerJwtGuard devralır. Kayıt/giriş gibi uçlar ayrıca
 * `@Public()` taşır.
 */
@ApiTags('Müşteri — Kimlik')
@CustomerAuth()
@Controller('customer-auth')
export class CustomerAuthController {
  constructor(private readonly service: CustomerAuthService) {}

  @Public()
  @Throttle(REGISTER_THROTTLE)
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Müşteri kaydı',
    description: [
      'Ad, soyad, e-posta, telefon, şifre ve KVKK onayı ile hesap oluşturur.',
      '',
      '**JETON DÖNMEZ.** Yanıt, e-posta kayıtlı olsun ya da olmasın AYNIDIR',
      '(kullanıcı sayımı / enumeration koruması). İstemci kayıttan sonra',
      '`POST /customer-auth/login` çağırır.',
      '',
      'Adres zaten kayıtlıysa yeni bir hesap açılmaz; adresin SAHİBİNE',
      '"hesabınız var, gerekirse şifrenizi sıfırlayın" e-postası gider.',
      '',
      '**Şifre politikası**: en az 8 karakter, en az bir harf ve bir rakam.',
      'İhlalinde `WEAK_PASSWORD` döner.',
      '',
      'KVKK onayı `true` DEĞİLSE `CONSENT_REQUIRED` ile reddedilir.',
      '',
      'Hız sınırı: saatte 5 istek.',
    ].join('\n'),
  })
  async register(
    @Body() dto: CustomerRegisterDto,
    @Req() request: Request,
  ): Promise<CustomerRegisterResponse> {
    return this.service.register(dto, getRequestContext(request));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Müşteri girişi',
    description: [
      'E-posta ve şifre ile giriş yapar; erişim ve yenileme jetonu döner.',
      '',
      'Yanlış e-posta ve yanlış şifre AYNI hatayı döndürür',
      '(`INVALID_CREDENTIALS`). 5 ardışık hatalı denemeden sonra hesap 15',
      'dakika kilitlenir.',
      '',
      'E-POSTA DOĞRULAMASI GİRİŞİN ÖNKOŞULU DEĞİLDİR: doğrulamamış kullanıcı',
      'da sepetini kullanabilir ve talep gönderebilir. Doğrulama yalnız',
      'geçmiş misafir taleplerinin hesaba bağlanması için gereklidir.',
      '',
      'Dönen jeton `aud: zirve-customer` taşır ve `/admin/*` uçlarında',
      'GEÇERSİZDİR.',
    ].join('\n'),
  })
  async login(
    @Body() dto: CustomerLoginDto,
    @Req() request: Request,
  ): Promise<CustomerLoginResponse> {
    return this.service.login(dto, getRequestContext(request));
  }

  @Public()
  @Throttle(REFRESH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Jeton yenileme',
    description: [
      'Yenileme jetonunu yeni bir jeton çiftiyle değiştirir.',
      '',
      '**Yenileme jetonu TEK KULLANIMLIKTIR.** Kullanılan jeton anında iptal',
      'edilir. İptal edilmiş bir jeton tekrar kullanılırsa jetonun sızdığı',
      'varsayılır ve hesabın TÜM oturumları düşürülür.',
    ].join('\n'),
  })
  async refresh(
    @Body() dto: CustomerRefreshTokenDto,
    @Req() request: Request,
  ): Promise<CustomerLoginResponse> {
    return this.service.refresh(dto.refreshToken, getRequestContext(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('customer-token')
  @ApiOperation({
    summary: 'Çıkış',
    description:
      'Gönderilen yenileme jetonunu iptal eder. Erişim jetonu kendi kısa ömrü ' +
      'dolana kadar geçerli kalır. Jeton gönderilmese de çıkış başarılı sayılır.',
  })
  async logout(
    @CurrentCustomer() customer: RequestCustomer,
    @Body() dto: CustomerLogoutDto,
    @Req() request: Request,
  ): Promise<{ success: boolean }> {
    await this.service.logout(customer.id, dto.refreshToken, getRequestContext(request));

    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth('customer-token')
  @ApiOperation({
    summary: 'Oturum açmış müşteri',
    description: 'Geçerli müşteri jetonuna karşılık gelen hesabın profilini döner.',
  })
  async me(@CurrentCustomer('id') accountId: string): Promise<CustomerAccountProfile> {
    return this.service.getProfile(accountId);
  }

  @Public()
  @Throttle(VERIFY_EMAIL_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'E-posta doğrula',
    description: [
      'E-postadaki tek kullanımlık jetonu tüketir ve hesabı doğrulanmış',
      'işaretler.',
      '',
      '**GEÇMİŞ MİSAFİR TALEPLERİ BURADA BAĞLANIR**: aynı e-posta adresiyle',
      'giriş yapmadan gönderilmiş talepler hesaba taşınır ve yanıtta',
      '`linkedInquiryCount` olarak döner.',
      '',
      'Telefon eşleşmesiyle otomatik bağlama YAPILMAZ (SMS doğrulaması yok —',
      'hesap ele geçirme riski). Yönetici talep detayından elle bağlayabilir.',
      '',
      'Geçersiz, süresi dolmuş ve kullanılmış jeton AYNI hatayı verir:',
      '`INVALID_TOKEN`.',
    ].join('\n'),
  })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() request: Request,
  ): Promise<CustomerVerifyEmailResponse> {
    return this.service.verifyEmail(dto.token, getRequestContext(request));
  }

  @Throttle(RESEND_THROTTLE)
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('customer-token')
  @ApiOperation({
    summary: 'Doğrulama e-postasını yeniden gönder',
    description:
      'Bekleyen eski doğrulama jetonlarını geçersizleştirir ve yenisini gönderir. ' +
      'Hesap zaten doğrulanmışsa hiçbir şey yapmaz ve başarılı döner.',
  })
  async resendVerification(
    @CurrentCustomer('id') accountId: string,
    @Req() request: Request,
  ): Promise<{ success: true; message: string }> {
    return this.service.resendVerification(accountId, getRequestContext(request));
  }

  @Public()
  @Throttle(FORGOT_PASSWORD_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Şifre sıfırlama bağlantısı iste',
    description: [
      'Adres kayıtlı olsa da olmasa da AYNI yanıtı döner (enumeration',
      'koruması). Bağlantı 30 dakika geçerli ve tek kullanımlıktır.',
      '',
      'Hız sınırı: saatte 3 istek. Bu uç, isteyen herkesin başkasının posta',
      'kutusuna e-posta göndertebildiği tek yer olduğu için en sıkı sınıra',
      'sahiptir.',
    ].join('\n'),
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<{ success: true; message: string }> {
    return this.service.forgotPassword(dto.email, getRequestContext(request));
  }

  @Public()
  @Throttle(RESET_PASSWORD_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Şifreyi sıfırla',
    description: [
      'Jetonu tüketir ve yeni şifreyi yazar.',
      '',
      '**TÜM OTURUMLAR DÜŞÜRÜLÜR**: şifre sıfırlamanın en yaygın nedeni hesabın',
      'ele geçirilmiş olmasıdır; saldırganın elindeki yenileme jetonu geçerli',
      'kalırsa işlemin anlamı olmaz. Bekleyen diğer sıfırlama bağlantıları da',
      'geçersizleşir.',
      '',
      `Hatalı şifre politikasında \`${ERROR_CODES.WEAK_PASSWORD}\` döner.`,
    ].join('\n'),
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
  ): Promise<{ success: true; message: string }> {
    return this.service.resetPassword(dto.token, dto.password, getRequestContext(request));
  }
}
