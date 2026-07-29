import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ACTIVE_USER_ROLES, USER_ROLES, type UserRole } from '@zirve/types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/dto/auth.dto';

/** Kullanıcı listesinde sıralanabilecek alanlar (whitelist — K-74). */
export const USER_SORT_FIELDS = ['createdAt', 'fullName', 'email', 'lastLoginAt', 'role'] as const;

export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class CreateUserDto {
  @ApiProperty({ example: 'yeni.yonetici@zirvetarim.example', maxLength: 255 })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'Ayşe Yılmaz', minLength: 3, maxLength: 150 })
  @IsString()
  @MinLength(3, { message: 'Ad soyad en az 3 karakter olmalıdır.' })
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName!: string;

  @ApiProperty({
    example: 'GucluGecici123',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'En az 10 karakter; harf ve rakam içermelidir.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/(?=.*[A-Za-zÇĞİÖŞÜçğıöşü])(?=.*\d)/, {
    message: 'Şifre en az bir harf ve bir rakam içermelidir.',
  })
  password!: string;

  @ApiProperty({
    enum: ACTIVE_USER_ROLES,
    example: 'ADMIN',
    description:
      'MVP kapsamında yalnız SUPER_ADMIN ve ADMIN atanabilir. Diğer roller enum’da ileriye dönük olarak bulunur.',
  })
  @IsIn(ACTIVE_USER_ROLES, { message: 'Geçersiz rol. İzinli değerler: SUPER_ADMIN, ADMIN.' })
  role!: UserRole;

  @ApiPropertyOptional({ example: '+90 555 000 00 00', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  phone?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Ayşe Yılmaz', minLength: 3, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName?: string;

  @ApiPropertyOptional({ example: '+90 555 000 00 00', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ enum: ACTIVE_USER_ROLES, example: 'ADMIN' })
  @IsOptional()
  @IsIn(ACTIVE_USER_ROLES, { message: 'Geçersiz rol. İzinli değerler: SUPER_ADMIN, ADMIN.' })
  role?: UserRole;
}

export class SetUserStatusDto {
  @ApiProperty({ example: false, description: 'false ise kullanıcı giriş yapamaz.' })
  @IsBoolean({ message: 'isActive true veya false olmalıdır.' })
  isActive!: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/(?=.*[A-Za-zÇĞİÖŞÜçğıöşü])(?=.*\d)/, {
    message: 'Şifre en az bir harf ve bir rakam içermelidir.',
  })
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mevcut şifre.' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/(?=.*[A-Za-zÇĞİÖŞÜçğıöşü])(?=.*\d)/, {
    message: 'Şifre en az bir harf ve bir rakam içermelidir.',
  })
  newPassword!: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    default: 'createdAt',
    description: 'Sıralama alanı. Yalnız listelenen değerler kabul edilir.',
  })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${USER_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: UserSortField = 'createdAt';

  @ApiPropertyOptional({ enum: USER_ROLES, description: 'Role göre filtrele.' })
  @IsOptional()
  @IsIn(USER_ROLES, { message: 'Geçersiz rol filtresi.' })
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Aktiflik durumuna göre filtrele.',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      if (value === 'true') {
        return true;
      }

      if (value === 'false') {
        return false;
      }
    }

    return undefined;
  })
  @IsBoolean({ message: 'isActive true veya false olmalıdır.' })
  isActive?: boolean;
}
