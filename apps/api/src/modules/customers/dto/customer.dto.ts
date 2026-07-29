import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_MIN_LENGTH,
  CUSTOMER_TYPES,
  type CustomerType,
} from '@zirve/types';

import { BaseQueryDto } from '../../../common/dto/base-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * Telefon biçimi — talep formundaki desenle AYNI.
 *
 * Aynı numara hem talepte hem müşteride aynı normalleştirmeden geçer;
 * mükerrer müşteri tespiti ve talep-müşteri eşleştirmesi buna dayanır.
 */
const PHONE_PATTERN = /^(\+?90[\s-]?)?0?[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/;

export class CreateCustomerDto {
  @ApiProperty({ enum: CUSTOMER_TYPES, default: 'INDIVIDUAL' })
  @IsIn(CUSTOMER_TYPES, {
    message: `type yalnız şunlardan biri olabilir: ${CUSTOMER_TYPES.join(', ')}.`,
  })
  type: CustomerType = 'INDIVIDUAL';

  @ApiProperty({ description: 'Ad soyad.', example: 'Ahmet Yılmaz' })
  @IsString()
  @IsNotEmpty({ message: 'Ad soyad zorunludur.' })
  @MinLength(3, { message: 'Ad soyad en az 3 karakter olmalıdır.' })
  @MaxLength(200)
  @Trim()
  fullName!: string;

  @ApiPropertyOptional({ description: 'Kurumsal müşteride ticari unvan.' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  @TrimToUndefined()
  companyName?: string;

  @ApiProperty({ description: 'Telefon numarası.', example: '0532 123 45 67' })
  @IsString()
  @IsNotEmpty({ message: 'Telefon numarası zorunludur.' })
  @Matches(PHONE_PATTERN, { message: 'Telefon numarası geçerli bir cep numarası olmalıdır.' })
  @Trim()
  phone!: string;

  @ApiPropertyOptional({ description: 'İkinci telefon.' })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'İkinci telefon geçerli bir cep numarası olmalıdır.' })
  @TrimToUndefined()
  altPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @TrimToUndefined()
  email?: string;

  @ApiPropertyOptional({ description: 'TCKN (bireysel) veya VKN (kurumsal).' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimToUndefined()
  taxNumber?: string;

  @ApiPropertyOptional({ description: 'Vergi dairesi.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @TrimToUndefined()
  taxOffice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  address?: string;

  @ApiPropertyOptional({
    description: 'Kredi limiti. Sayısal METİN olarak gönderilir (Kural 2).',
    example: '10000.00',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'creditLimit sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  creditLimit?: string;

  @ApiPropertyOptional({
    description: 'Devir bakiyesi. Pozitif = müşteri borçlu.',
    example: '0.00',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'openingBalance sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  openingBalance?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;
}

/**
 * Güncelleme gövdesi.
 *
 * `PartialType` KULLANILMADI: `openingBalance` bilinçli olarak dışarıda.
 * Devir bakiyesi sisteme geçiş anında bir kez girilir; sonradan
 * değiştirilmesi geçmiş borç hesabını sessizce kaydırır. Değişmesi
 * gerekiyorsa düzeltme ödemesi/satışı ile yapılmalıdır.
 */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: CustomerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Ad soyad en az 3 karakter olmalıdır.' })
  @MaxLength(200)
  @Trim()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  @TrimToUndefined()
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'Telefon numarası geçerli bir cep numarası olmalıdır.' })
  @Trim()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'İkinci telefon geçerli bir cep numarası olmalıdır.' })
  @TrimToUndefined()
  altPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @TrimToUndefined()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimToUndefined()
  taxNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @TrimToUndefined()
  taxOffice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'creditLimit sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  creditLimit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;

  @ApiPropertyOptional({ description: 'Pasif müşteri yeni satışta seçilemez.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Müşteri görüşme notu gövdesi. */
export class CreateCustomerNoteDto {
  @ApiProperty({
    description: 'Görüşme notu. Tarihli kayıt zincirine eklenir; sonradan üzerine yazılmaz.',
    example: 'Gübre fiyatı sordu, hafta içi tekrar arayacak.',
    minLength: CUSTOMER_NOTE_MIN_LENGTH,
    maxLength: CUSTOMER_NOTE_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'Not içeriği zorunludur.' })
  @MinLength(CUSTOMER_NOTE_MIN_LENGTH, {
    message: `Not en az ${CUSTOMER_NOTE_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(CUSTOMER_NOTE_MAX_LENGTH)
  @Trim()
  body!: string;
}

/** Mükerrer telefon kontrolü sorgusu — form kaydetmeden ÖNCE uyarabilsin. */
export class CheckDuplicatePhoneDto {
  @ApiProperty({ example: '0532 123 45 67' })
  @IsString()
  @IsNotEmpty({ message: 'Telefon numarası zorunludur.' })
  @Trim()
  phone!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Düzenlenen müşteri. Kendi kaydı mükerrer sayılmaz.',
  })
  @IsOptional()
  @IsUUID('4')
  excludeId?: string;
}

/** Sıralanabilir alanlar (K-74: serbest alan adı kabul edilmez). */
export const CUSTOMER_SORT_FIELDS = ['createdAt', 'fullName', 'code', 'phone'] as const;

export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class CustomerQueryDto extends BaseQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${CUSTOMER_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: CustomerSortField = 'createdAt';

  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: CustomerType;

  @ApiPropertyOptional({ description: 'Yalnız borcu olan müşteriler.' })
  @IsOptional()
  @IsString()
  @IsIn(['1'], { message: 'hasDebt yalnız "1" olabilir.' })
  hasDebt?: string;
}
