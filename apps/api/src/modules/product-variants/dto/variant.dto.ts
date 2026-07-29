import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * SKU biçimi: harf, rakam, tire ve alt çizgi. Boşluk ve Türkçe karakter yok —
 * SKU barkod/etiket sistemlerinde ve dosya adlarında kullanılır.
 */
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

/**
 * Parasal ve miktar alanları STRING taşınır (docs/ARCHITECTURE.md §13.6).
 * `number` olarak almak, JSON'daki IEEE-754 dönüşümü nedeniyle kuruş kaybeder.
 */
class VariantNumericFields {
  @ApiProperty({ example: '5.000', description: 'Ambalajdaki miktar. 5 kg çuval için "5".' })
  @IsNumberString({}, { message: 'unitQuantity sayısal bir metin olmalıdır.' })
  unitQuantity!: string;

  @ApiPropertyOptional({ example: '0.0000', description: 'HASSAS: public yanıtta ASLA dönmez.' })
  @IsOptional()
  @IsNumberString({}, { message: 'purchasePrice sayısal bir metin olmalıdır.' })
  purchasePrice?: string;

  @ApiProperty({ example: '450.0000' })
  @IsNumberString({}, { message: 'salePrice sayısal bir metin olmalıdır.' })
  salePrice!: string;

  @ApiPropertyOptional({ example: '20.000', description: 'KDV oranı yüzde.' })
  @IsOptional()
  @IsNumberString({}, { message: 'taxRate sayısal bir metin olmalıdır.' })
  taxRate?: string;

  @ApiPropertyOptional({ example: '5.000', default: '1' })
  @IsOptional()
  @IsNumberString({}, { message: 'minOrderQuantity sayısal bir metin olmalıdır.' })
  minOrderQuantity?: string;

  @ApiPropertyOptional({
    example: '5.000',
    default: '1',
    description: 'Miktar bu adımın katları olmalıdır.',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'quantityStep sayısal bir metin olmalıdır.' })
  quantityStep?: string;

  @ApiPropertyOptional({ example: '100.000', description: 'Null ise sınırsız.' })
  @IsOptional()
  @IsNumberString({}, { message: 'maxOrderQuantity sayısal bir metin olmalıdır.' })
  maxOrderQuantity?: string;

  @ApiPropertyOptional({
    example: '0.000',
    default: '0',
    description: [
      'BAŞLANGIÇ STOĞU — yalnız varyasyon OLUŞTURULURKEN kabul edilir.',
      '',
      'Değer doğrudan yazılmaz: aynı transaction içinde bir INITIAL stok',
      'hareketi üretir. Böylece varyasyonun ilk stoğunun da geçmişte bir',
      'karşılığı olur (Sprint 9 şartı 2).',
    ].join('\n'),
  })
  @IsOptional()
  @IsNumberString({}, { message: 'stockQuantity sayısal bir metin olmalıdır.' })
  stockQuantity?: string;

  @ApiPropertyOptional({ example: '10.000', default: '0' })
  @IsOptional()
  @IsNumberString({}, { message: 'lowStockThreshold sayısal bir metin olmalıdır.' })
  lowStockThreshold?: string;
}

export class CreateVariantDto extends VariantNumericFields {
  @ApiProperty({
    example: 'AGM-NPK-5KG',
    description: 'Stok kodu. Tüm ürünler arasında benzersizdir. Büyük harf, rakam, tire.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(SKU_PATTERN, {
    message: 'SKU yalnız büyük harf, rakam, tire ve alt çizgi içerebilir (ör. AGM-NPK-5KG).',
  })
  sku!: string;

  @ApiPropertyOptional({ example: '5 kg Çuval', description: 'Boşsa birim ve miktardan üretilir.' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @TrimToUndefined()
  name?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'unitTypeId geçerli bir UUID olmalıdır.' })
  unitTypeId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Ürün başına yalnız BİR varsayılan olabilir.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateVariantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(SKU_PATTERN, {
    message: 'SKU yalnız büyük harf, rakam, tire ve alt çizgi içerebilir.',
  })
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Trim()
  name?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  unitTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'unitQuantity sayısal bir metin olmalıdır.' })
  unitQuantity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'purchasePrice sayısal bir metin olmalıdır.' })
  purchasePrice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'salePrice sayısal bir metin olmalıdır.' })
  salePrice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'taxRate sayısal bir metin olmalıdır.' })
  taxRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'minOrderQuantity sayısal bir metin olmalıdır.' })
  minOrderQuantity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'quantityStep sayısal bir metin olmalıdır.' })
  quantityStep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({}, { message: 'maxOrderQuantity sayısal bir metin olmalıdır.' })
  maxOrderQuantity?: string;

  /**
   * ARTIK KABUL EDİLMİYOR (Sprint 9).
   *
   * Alan DTO'da BİLİNÇLİ olarak bırakıldı: kaldırılsaydı `forbidNonWhitelisted`
   * "property stockQuantity should not exist" gibi kör bir hata verirdi.
   * Burada durunca servis, kullanıcıyı doğru akışa yönlendiren bir mesaj
   * döndürebiliyor: stok yalnız stok hareketiyle değişir.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'KULLANILMIYOR. Gönderilirse istek 400 ile reddedilir. ' +
      'Stok değişikliği için: POST /admin/stock/adjustment',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'stockQuantity sayısal bir metin olmalıdır.' })
  stockQuantity?: string;

  @ApiPropertyOptional({ description: 'Kritik stok eşiği. Stok DEĞİL, uyarı ayarıdır.' })
  @IsOptional()
  @IsNumberString({}, { message: 'lowStockThreshold sayısal bir metin olmalıdır.' })
  lowStockThreshold?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
