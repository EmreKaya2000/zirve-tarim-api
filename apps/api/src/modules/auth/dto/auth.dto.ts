import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '@zirve/types';

/** Şifre uzunluk sınırları. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export class LoginDto {
  @ApiProperty({ example: 'admin@zirvetarim.example', maxLength: 255 })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'CokGuvenliSifre123', minLength: 1, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @IsNotEmpty({ message: 'Şifre zorunludur.' })
  // Girişte uzunluk kuralı UYGULANMAZ: eski şifreler kuraldan kısa olabilir
  // ve mesajın kendisi şifre politikası hakkında bilgi sızdırır.
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Yenileme jetonu. Gövdede gönderilmezse `refresh_token` çerezinden okunur (web istemcisi).',
  })
  @IsString()
  @IsNotEmpty({ message: 'Yenileme jetonu zorunludur.' })
  @MaxLength(512)
  refreshToken!: string;
}

// --- Swagger yanıt modelleri ---

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@zirvetarim.example' })
  email!: string;

  @ApiProperty({ example: 'Emre Kaya' })
  fullName!: string;

  @ApiProperty({ type: String, nullable: true, example: '+90 555 000 00 00' })
  phone!: string | null;

  @ApiProperty({ enum: USER_ROLES, example: 'ADMIN' })
  role!: UserRole;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '2026-07-28T08:15:00.000Z' })
  lastLoginAt!: string | null;

  @ApiProperty({ example: '2026-07-01T10:00:00.000Z' })
  createdAt!: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Kısa ömürlü erişim jetonu (JWT).' })
  accessToken!: string;

  @ApiProperty({ description: 'Uzun ömürlü, TEK KULLANIMLIK yenileme jetonu.' })
  refreshToken!: string;

  @ApiProperty({ example: 900, description: 'Erişim jetonunun ömrü (saniye).' })
  expiresIn!: number;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
