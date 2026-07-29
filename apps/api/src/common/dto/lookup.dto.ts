import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** Ad alanı sınırları — tüm taksonomi modüllerinde ortak. */
export const LOOKUP_NAME_MIN_LENGTH = 2;
export const LOOKUP_NAME_MAX_LENGTH = 150;

/** Boş string'i `undefined` yapar: opsiyonel alanlarda "" göndermek temizlenir. */
export function TrimToUndefined() {
  return Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    return trimmed === '' ? undefined : trimmed;
  });
}

/** Boşlukları kırpar ama boş string'i korur. */
export function Trim() {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
}

/**
 * Taksonomi kayıtlarının ortak oluşturma alanları.
 *
 * Slug BİLİNÇLİ OLARAK YOKTUR: addan sunucuda üretilir. İstemcinin slug
 * göndermesine izin vermek, çakışma ve tutarsızlık yönetimini istemciye
 * devretmek olurdu.
 */
export class BaseLookupCreateDto {
  @ApiProperty({
    example: 'Buğday',
    minLength: LOOKUP_NAME_MIN_LENGTH,
    maxLength: LOOKUP_NAME_MAX_LENGTH,
  })
  @IsString()
  @MinLength(LOOKUP_NAME_MIN_LENGTH, {
    message: `Ad en az ${LOOKUP_NAME_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(LOOKUP_NAME_MAX_LENGTH)
  @Trim()
  name!: string;

  @ApiPropertyOptional({ description: 'Serbest metin açıklama.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  description?: string;

  @ApiPropertyOptional({ description: 'Listeleme sırası. Küçük değer önce gelir.', default: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt({ message: 'sortOrder tam sayı olmalıdır.' })
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Public tarafta görünür mü?', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Ortak güncelleme alanları.
 *
 * `PartialType` yerine ayrı sınıf kullanılır: `name` burada opsiyoneldir ama
 * verildiğinde aynı uzunluk kurallarına tabidir ve Swagger'da doğru görünür.
 */
export class BaseLookupUpdateDto {
  @ApiPropertyOptional({
    example: 'Buğday',
    minLength: LOOKUP_NAME_MIN_LENGTH,
    maxLength: LOOKUP_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(LOOKUP_NAME_MIN_LENGTH, {
    message: `Ad en az ${LOOKUP_NAME_MIN_LENGTH} karakter olmalıdır.`,
  })
  @MaxLength(LOOKUP_NAME_MAX_LENGTH)
  @Trim()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Aktiflik değiştirme gövdesi. */
export class SetActiveDto {
  @ApiProperty({ example: false })
  @IsBoolean({ message: 'isActive true veya false olmalıdır.' })
  isActive!: boolean;
}
