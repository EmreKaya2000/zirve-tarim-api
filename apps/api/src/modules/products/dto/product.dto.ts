import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SideEffectSeverity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PRODUCT_SORT_OPTIONS, type ProductSortOption } from '@zirve/types';

import { BooleanQuery } from '../../../common/dto/base-query.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';
import { CreateVariantDto } from '../../product-variants/dto/variant.dto';

// =============================================================================
// İLİŞKİ ALT NESNELERİ
// =============================================================================

/** Ürün–kategori bağlantısı. */
export class ProductCategoryInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'categoryId geçerli bir UUID olmalıdır.' })
  categoryId!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Ana kategori. Ürün başına YALNIZ BİR tane olabilir.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** Not taşıyabilen basit taksonomi bağlantısı (bitki, toprak, dönem). */
export class TaxonomyLinkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  note?: string;
}

/** Yarar bağlantısı — sıralanabilir. */
export class ProductBenefitInputDto extends TaxonomyLinkDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** Yan etki bağlantısı — ciddiyet bu ürün için ezilebilir. */
export class ProductSideEffectInputDto extends TaxonomyLinkDto {
  @ApiPropertyOptional({
    enum: SideEffectSeverity,
    description:
      'Bu ÜRÜN için ciddiyet farklıysa buradan ezilir. Verilmezse yan etkinin genel seviyesi kullanılır.',
  })
  @IsOptional()
  @IsEnum(SideEffectSeverity, { message: 'Geçersiz ciddiyet seviyesi.' })
  severityOverride?: SideEffectSeverity;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// =============================================================================
// OLUŞTURMA / GÜNCELLEME
// =============================================================================

class ProductBaseDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  @TrimToUndefined()
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'brandId geçerli bir UUID olmalıdır.' })
  brandId?: string;

  // --- Tarımsal bilgiler ---

  @ApiPropertyOptional({ description: 'Nasıl uygulanır.' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  @TrimToUndefined()
  usageInstructions?: string;

  @ApiPropertyOptional({ description: 'İçerik / etken madde.' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  @TrimToUndefined()
  ingredients?: string;

  @ApiPropertyOptional({ description: 'Saklama koşulları.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @TrimToUndefined()
  storageConditions?: string;

  @ApiPropertyOptional({ description: 'Bakanlık ruhsat numarası.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @TrimToUndefined()
  licenseNumber?: string;

  // --- Yayın ayarları ---

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Public katalogda yayınlansın mı? En az bir aktif varyasyon gerektirir.',
  })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: true, description: 'false ise public tarafta fiyat gizlenir.' })
  @IsOptional()
  @IsBoolean()
  showPrice?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  metaTitle?: string;

  @ApiPropertyOptional({ maxLength: 400 })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @TrimToUndefined()
  metaDesc?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // --- İlişkiler ---

  @ApiPropertyOptional({ type: [TaxonomyLinkDto], description: 'Kullanılabilen bitkiler.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxonomyLinkDto)
  plants?: TaxonomyLinkDto[];

  @ApiPropertyOptional({ type: [TaxonomyLinkDto], description: 'Uygun toprak türleri.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxonomyLinkDto)
  soilTypes?: TaxonomyLinkDto[];

  @ApiPropertyOptional({ type: [ProductBenefitInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductBenefitInputDto)
  benefits?: ProductBenefitInputDto[];

  @ApiPropertyOptional({ type: [ProductSideEffectInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSideEffectInputDto)
  sideEffects?: ProductSideEffectInputDto[];

  @ApiPropertyOptional({ type: [TaxonomyLinkDto], description: 'Uygun kullanım dönemleri.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxonomyLinkDto)
  usagePeriods?: TaxonomyLinkDto[];
}

export class CreateProductDto extends ProductBaseDto {
  @ApiProperty({ example: 'AgroMax NPK 20-20-20', minLength: 2, maxLength: 220 })
  @IsString()
  @MinLength(2, { message: 'Ürün adı en az 2 karakter olmalıdır.' })
  @MaxLength(220)
  @Trim()
  name!: string;

  @ApiProperty({
    type: [ProductCategoryInputDto],
    description: 'En az bir kategori zorunludur; yalnız biri ana kategori olabilir.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'En az bir kategori seçilmelidir.' })
  @ValidateNested({ each: true })
  @Type(() => ProductCategoryInputDto)
  categories!: ProductCategoryInputDto[];

  /**
   * Ürünle BİRLİKTE oluşturulacak varyasyonlar — ZORUNLU, en az bir tane.
   *
   * SPEC §15.3: "Ürünün en az bir aktif varyasyonu olmalıdır." Bu kural bir
   * DEĞİŞMEZDİR (invariant), yalnız yayınlama ön koşulu değil: fiyat, stok ve
   * SKU varyasyon düzeyinde tutulduğu için varyasyonsuz ürün satılabilir bir
   * kayıt değildir (SPEC §5.3).
   *
   * Alan eskiden opsiyoneldi ve ürün varyasyonsuz oluşturulabiliyordu; kural
   * yalnız yayına alırken kontrol ediliyordu. Sonuç, kataloğun içinde sessizce
   * birikebilen satılamaz ürünlerdi.
   *
   * Ürün ve varyasyonları AYNI transaction'da yazılır: biri geçersizse hiçbiri
   * kaydedilmez.
   */
  @ApiProperty({
    type: [CreateVariantDto],
    description:
      'ZORUNLU: en az bir varyasyon ve içlerinden en az biri aktif olmalıdır (SPEC §15.3). ' +
      'Ürünle aynı transaction içinde oluşturulur; biri geçersizse ürün de kaydedilmez.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Ürün en az bir varyasyonla oluşturulmalıdır.' })
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}

export class UpdateProductDto extends ProductBaseDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 220 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Ürün adı en az 2 karakter olmalıdır.' })
  @MaxLength(220)
  @Trim()
  name?: string;

  @ApiPropertyOptional({
    type: [ProductCategoryInputDto],
    description: 'Gönderilirse kategori bağlantıları TAMAMEN değiştirilir.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'En az bir kategori seçilmelidir.' })
  @ValidateNested({ each: true })
  @Type(() => ProductCategoryInputDto)
  categories?: ProductCategoryInputDto[];
}

// =============================================================================
// LİSTE SORGULARI
// =============================================================================

/** Yönetim listesinde izin verilen sıralama alanları (K-74). */
export const ADMIN_PRODUCT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'sortOrder',
  'viewCount',
] as const;

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_PRODUCT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ADMIN_PRODUCT_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${ADMIN_PRODUCT_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: (typeof ADMIN_PRODUCT_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ description: 'Stok eşiğinin altındaki ürünler.' })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  lowStock?: boolean;
}

/**
 * Public ürün listesi filtreleri (SPEC §4.6).
 *
 * Fiyat alanları STRING taşınır (docs/ARCHITECTURE.md §13.6): sorgu
 * parametresini number'a çevirmek kuruş hassasiyetini bozar.
 */
export class PublicProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Kategori slug. ALT KATEGORİLER DE dahil edilir.',
    example: 'gubre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  @TrimToUndefined()
  category?: string;

  @ApiPropertyOptional({ description: 'Marka slug (virgülle çoklu).', example: 'agromax' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  brand?: string;

  @ApiPropertyOptional({ description: 'Bitki slug (virgülle çoklu).', example: 'bugday' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  plant?: string;

  @ApiPropertyOptional({ description: 'Toprak türü slug (virgülle çoklu).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  soilType?: string;

  @ApiPropertyOptional({ description: 'Birim kodu (virgülle çoklu).', example: 'kg,lt' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  unit?: string;

  @ApiPropertyOptional({ description: 'Yalnız stokta olanlar.' })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ description: 'En düşük fiyat.', example: '100.00' })
  @IsOptional()
  @IsNumberString({}, { message: 'minPrice sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  minPrice?: string;

  @ApiPropertyOptional({ description: 'En yüksek fiyat.', example: '5000.00' })
  @IsOptional()
  @IsNumberString({}, { message: 'maxPrice sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  maxPrice?: string;

  @ApiPropertyOptional({ description: 'Yalnız öne çıkanlar.' })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ enum: PRODUCT_SORT_OPTIONS, default: 'newest' })
  @IsOptional()
  @IsIn(PRODUCT_SORT_OPTIONS, {
    message: `sort yalnız şunlardan biri olabilir: ${PRODUCT_SORT_OPTIONS.join(', ')}.`,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  sort: ProductSortOption = 'newest';
}
