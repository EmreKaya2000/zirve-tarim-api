import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ERROR_CODES, type AuthUser, type LoginResponse } from '@zirve/types';

import {
  ApiErrorResponse,
  ApiStandardResponse,
} from '../../common/swagger/api-response.decorators';
import { getRequestContext } from '../../common/utils/request-context';
import { AuthService } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthUserDto,
  LoginDto,
  LoginResponseDto,
  LogoutResponseDto,
  RefreshTokenDto,
} from './dto/auth.dto';

/**
 * Giriş ucu için sıkı hız sınırı.
 *
 * Genel limit (120/dk) kaba kuvvet denemesine karşı çok gevşektir.
 * Buradaki 5/dk, hesap kilidiyle (5 hatalı deneme) birlikte iki katmanlı
 * koruma oluşturur: biri IP başına, diğeri hesap başına.
 */
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** Yenileme ucu için orta seviye limit. */
const REFRESH_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Yönetici girişi',
    description: [
      'E-posta ve şifre ile giriş yapar; erişim ve yenileme jetonu döner.',
      '',
      '**Güvenlik notları**',
      '- Yanlış e-posta ve yanlış şifre AYNI hatayı döndürür (`INVALID_CREDENTIALS`).',
      '  Hangi alanın hatalı olduğu bilinçli olarak söylenmez.',
      '- Pasif hesap giriş yapamaz (`ACCOUNT_INACTIVE`).',
      '- 5 ardışık hatalı denemeden sonra hesap 15 dakika kilitlenir.',
      '- Hız sınırı: dakikada 5 istek.',
    ].join('\n'),
  })
  @ApiStandardResponse(LoginResponseDto, { description: 'Giriş başarılı.' })
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.INVALID_CREDENTIALS,
    'E-posta veya şifre hatalı / hesap pasif / hesap kilitli.',
  )
  @ApiErrorResponse(
    HttpStatus.TOO_MANY_REQUESTS,
    ERROR_CODES.RATE_LIMIT_EXCEEDED,
    'Çok fazla giriş denemesi.',
  )
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResponse> {
    return this.authService.login(dto.email, dto.password, getRequestContext(request));
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
      '**Yenileme jetonu TEK KULLANIMLIKTIR.** Kullanılan jeton anında iptal edilir.',
      'İptal edilmiş bir jeton tekrar kullanılırsa jetonun sızdığı varsayılır ve',
      'kullanıcının TÜM oturumları düşürülür.',
    ].join('\n'),
  })
  @ApiStandardResponse(LoginResponseDto, { description: 'Yeni jeton çifti üretildi.' })
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.INVALID_REFRESH_TOKEN,
    'Yenileme jetonu geçersiz, süresi dolmuş veya iptal edilmiş.',
  )
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request): Promise<LoginResponse> {
    return this.authService.refresh(dto.refreshToken, getRequestContext(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Çıkış',
    description:
      'Gönderilen yenileme jetonunu iptal eder. Erişim jetonu kendi ömrü dolana kadar geçerli kalır (kısa ömürlüdür).',
  })
  @ApiStandardResponse(LogoutResponseDto, { description: 'Çıkış yapıldı.' })
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<{ success: boolean }> {
    await this.authService.logout(user.id, dto.refreshToken, getRequestContext(request));

    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Oturum açmış kullanıcı',
    description: 'Geçerli erişim jetonuna karşılık gelen kullanıcının profilini döner.',
  })
  @ApiStandardResponse(AuthUserDto, { description: 'Kullanıcı profili.' })
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, 'Geçerli oturum yok.')
  async me(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.authService.getProfile(userId);
  }
}
