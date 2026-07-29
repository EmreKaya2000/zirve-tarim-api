import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CUSTOMER_PASSWORD_MAX_LENGTH } from '@zirve/types';

import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * Türk cep telefonu biçimi.
 *
 * Talep formundaki (`inquiry.dto.ts`) PHONE_PATTERN ile AYNI desendir ve aynı
 * gerekçeyle gevşektir: çiftçi numarasını boşluklu, tireli veya ülke koduyla
 * yazar. Normalleştirme servis katmanında yapılır.
 *
 * İki dosyada tekrarlanıyor olması bilinçlidir: talep modülü ile müşteri
 * hesabı modülü birbirine bağımlı DEĞİLDİR ve biri değişirse diğerinin
 * sessizce etkilenmesi istenmez. Desenin kendisi veritabanı kısıtıyla
 * (`chk_customer_accounts_phone_normalized`) ayrıca güvence altındadır.
 */
const PHONE_PATTERN = /^(\+?90[\s-]?)?0?[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/;

/**
 * Şifre alanının ortak tanımı.
 *
 * BURADA YALNIZ ÜST SINIR DOĞRULANIR. Politikanın kendisi (asgari uzunluk,
 * harf + rakam) `isValidCustomerPassword` içindedir ve servis katmanında
 * uygulanır — kural TEK yerde yaşasın diye. Üst sınır burada olmalıdır:
 * 1 MB'lık bir gövde, doğrulamaya girmeden 19 MiB bellekli bir Argon2
 * hesabına dönüşürse bu tek başına bir DoS yüzeyidir.
 */
class PasswordFieldDto {
  @ApiProperty({
    description:
      'Şifre. En az 8 karakter, en az bir harf ve bir rakam içermelidir. ' +
      'Politika ihlalinde `WEAK_PASSWORD` döner.',
    minLength: 8,
    maxLength: CUSTOMER_PASSWORD_MAX_LENGTH,
    example: 'Tarla2026',
  })
  @IsString({ message: 'Şifre metin olmalıdır.' })
  @IsNotEmpty({ message: 'Şifre zorunludur.' })
  @MaxLength(CUSTOMER_PASSWORD_MAX_LENGTH, {
    message: `Şifre en fazla ${CUSTOMER_PASSWORD_MAX_LENGTH} karakter olabilir.`,
  })
  password!: string;
}

/** POST /customer-auth/register */
export class CustomerRegisterDto extends PasswordFieldDto {
  @ApiProperty({ description: 'Ad.', example: 'Ahmet', maxLength: 100 })
  @IsString()
  @IsNotEmpty({ message: 'Ad zorunludur.' })
  @MinLength(2, { message: 'Ad en az 2 karakter olmalıdır.' })
  @MaxLength(100)
  @Trim()
  firstName!: string;

  @ApiProperty({ description: 'Soyad.', example: 'Yılmaz', maxLength: 100 })
  @IsString()
  @IsNotEmpty({ message: 'Soyad zorunludur.' })
  @MinLength(2, { message: 'Soyad en az 2 karakter olmalıdır.' })
  @MaxLength(100)
  @Trim()
  lastName!: string;

  @ApiProperty({ description: 'E-posta adresi (giriş anahtarı).', example: 'ahmet@ornek.com' })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @Trim()
  email!: string;

  @ApiProperty({ description: 'Cep telefonu.', example: '0532 123 45 67' })
  @IsString()
  @IsNotEmpty({ message: 'Telefon numarası zorunludur.' })
  @Matches(PHONE_PATTERN, {
    message: 'Telefon numarası geçerli bir Türkiye cep numarası olmalıdır.',
  })
  @Trim()
  phone!: string;

  @ApiProperty({
    description: 'KVKK aydınlatma metni onayı. `true` DEĞİLSE kayıt reddedilir.',
    example: true,
  })
  @IsBoolean({ message: 'consentAccepted mantıksal bir değer olmalıdır.' })
  consentAccepted!: boolean;
}

/** POST /customer-auth/login */
export class CustomerLoginDto extends PasswordFieldDto {
  @ApiProperty({ description: 'E-posta adresi.', example: 'ahmet@ornek.com' })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @Trim()
  email!: string;
}

/** POST /customer-auth/refresh ve /logout */
export class CustomerRefreshTokenDto {
  @ApiProperty({ description: 'Yenileme jetonu.' })
  @IsString()
  @IsNotEmpty({ message: 'Yenileme jetonu zorunludur.' })
  @MaxLength(512)
  @Trim()
  refreshToken!: string;
}

/**
 * Çıkış gövdesi.
 *
 * `refreshToken` İSTEĞE BAĞLIDIR: istemci jetonunu kaybetmiş olsa bile çıkış
 * yapabilmelidir (erişim jetonu kısa ömürlüdür, kendiliğinden düşer).
 */
export class CustomerLogoutDto {
  @ApiPropertyOptional({ description: 'İptal edilecek yenileme jetonu.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @TrimToUndefined()
  refreshToken?: string;
}

/** POST /customer-auth/verify-email */
export class VerifyEmailDto {
  @ApiProperty({ description: 'E-postadaki bağlantıdan gelen jeton.' })
  @IsString()
  @IsNotEmpty({ message: 'Doğrulama jetonu zorunludur.' })
  @MaxLength(512)
  @Trim()
  token!: string;
}

/** POST /customer-auth/forgot-password */
export class ForgotPasswordDto {
  @ApiProperty({ description: 'Hesabın e-posta adresi.', example: 'ahmet@ornek.com' })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @Trim()
  email!: string;
}

/** POST /customer-auth/reset-password */
export class ResetPasswordDto extends PasswordFieldDto {
  @ApiProperty({ description: 'E-postadaki bağlantıdan gelen jeton.' })
  @IsString()
  @IsNotEmpty({ message: 'Sıfırlama jetonu zorunludur.' })
  @MaxLength(512)
  @Trim()
  token!: string;
}

/**
 * PATCH /customer/profile
 *
 * `email` DIŞINDAKİ alanlar anında uygulanır; e-posta değişikliği yeni adrese
 * gönderilen doğrulama bağlantısı açılana kadar BEKLER (Sprint 11 şartı 4).
 */
export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ description: 'Ad.', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Ad en az 2 karakter olmalıdır.' })
  @MaxLength(100)
  @Trim()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Soyad.', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Soyad en az 2 karakter olmalıdır.' })
  @MaxLength(100)
  @Trim()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Cep telefonu.', example: '0532 123 45 67' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'Telefon numarası geçerli bir Türkiye cep numarası olmalıdır.',
  })
  @Trim()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Yeni e-posta adresi. ANINDA UYGULANMAZ: yeni adrese doğrulama bağlantısı ' +
      'gönderilir ve adres ancak bağlantı açıldığında değişir.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @Trim()
  email?: string;
}
