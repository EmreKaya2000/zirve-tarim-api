import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  MANUAL_STOCK_MOVEMENT_TYPES,
  STOCK_DESCRIPTION_MAX_LENGTH,
  STOCK_MOVEMENT_DIRECTIONS,
  STOCK_MOVEMENT_TYPES,
  STOCK_REFERENCE_TYPES,
  type ManualStockMovementType,
  type StockMovementDirection,
  type StockReferenceType,
} from '@zirve/types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/** "1"/"true" gibi sorgu değerlerini boolean'a çevirir; diğerlerini undefined bırakır. */
function BooleanFlag() {
  return Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') {
      return true;
    }

    if (value === false || value === 'false' || value === '0') {
      return false;
    }

    return undefined;
  });
}

// =============================================================================
// STOK LİSTESİ
// =============================================================================

export const STOCK_SORT_FIELDS = ['stockQuantity', 'sku', 'salePrice', 'updatedAt'] as const;

export type StockSortField = (typeof STOCK_SORT_FIELDS)[number];

/**
 * Stok listesi sorgusu.
 *
 * Liste VARYASYON bazlıdır, ürün bazlı değil: stok varyasyonda tutulur ve
 * "5 kg çuval bitti ama 25 kg var" ürün seviyesinde görülemez.
 */
export class StockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STOCK_SORT_FIELDS, default: 'stockQuantity' })
  @IsOptional()
  @IsIn(STOCK_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${STOCK_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: StockSortField = 'stockQuantity';

  @ApiPropertyOptional({ format: 'uuid', description: 'Tek bir ürünün varyasyonları.' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  brandId?: string;

  @ApiPropertyOptional({
    description: 'Yalnız kritik stok altındakiler (stockQuantity <= lowStockThreshold).',
  })
  @IsOptional()
  @BooleanFlag()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ description: 'Stok takibi yapılan/yapılmayan varyasyonlar.' })
  @IsOptional()
  @BooleanFlag()
  trackStock?: boolean;

  @ApiPropertyOptional({ description: 'Pasif ve silinmiş varyasyonları da göster.' })
  @IsOptional()
  @BooleanFlag()
  includeInactive?: boolean;
}

// =============================================================================
// HAREKET GEÇMİŞİ
// =============================================================================

export const STOCK_MOVEMENT_SORT_FIELDS = ['createdAt', 'quantity'] as const;

export type StockMovementSortField = (typeof STOCK_MOVEMENT_SORT_FIELDS)[number];

export class StockMovementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${STOCK_MOVEMENT_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: StockMovementSortField = 'createdAt';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  variantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({
    enum: STOCK_MOVEMENT_TYPES,
    description: 'Virgülle çoklu verilebilir. Örn. `SALE,SALE_CANCEL`.',
  })
  @IsOptional()
  @IsString()
  @TrimToUndefined()
  type?: string;

  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_DIRECTIONS })
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_DIRECTIONS)
  direction?: StockMovementDirection;

  @ApiPropertyOptional({ enum: STOCK_REFERENCE_TYPES })
  @IsOptional()
  @IsIn(STOCK_REFERENCE_TYPES)
  referenceType?: StockReferenceType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Belge kimliği. Örn. satış id.' })
  @IsOptional()
  @IsUUID('4')
  referenceId?: string;
}

// =============================================================================
// STOK DÜZELTME
// =============================================================================

/**
 * Elle stok hareketi.
 *
 * SALE ve SALE_CANCEL BİLİNÇLİ OLARAK kabul edilmez: satış hareketi elle
 * yazılabilseydi, karşılığında satış belgesi olmayan bir "satış çıkışı"
 * üretilebilir ve stok ile ciro raporu sessizce ayrışırdı.
 */
export class CreateStockAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Geçerli bir varyasyon seçiniz.' })
  variantId!: string;

  @ApiProperty({
    enum: MANUAL_STOCK_MOVEMENT_TYPES,
    description: 'Hareket nedeni. Satış hareketleri (SALE, SALE_CANCEL) buradan girilemez.',
  })
  @IsIn(MANUAL_STOCK_MOVEMENT_TYPES, {
    message: `type yalnız şunlardan biri olabilir: ${MANUAL_STOCK_MOVEMENT_TYPES.join(', ')}.`,
  })
  type!: ManualStockMovementType;

  @ApiProperty({
    description: [
      'Hareket miktarı. Sayısal METİN (Kural 2) ve POZİTİF.',
      '',
      'INVENTORY_ADJUSTMENT tipinde bu alan bir DEĞİŞİM değil, SAYILAN',
      'fiziksel stoktur; yön ve fark kayıtlı stokla karşılaştırılarak',
      'hesaplanır.',
    ].join('\n'),
    example: '25',
  })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @Trim()
  quantity!: string;

  @ApiProperty({
    description: 'Hareket gerekçesi. ZORUNLUDUR — belgesiz stok değişiminin tek izi budur.',
    maxLength: STOCK_DESCRIPTION_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'Stok düzeltmesinde açıklama zorunludur.' })
  @MaxLength(STOCK_DESCRIPTION_MAX_LENGTH)
  @Trim()
  description!: string;

  @ApiPropertyOptional({
    description: 'Giriş hareketlerinde birim maliyet. Sayısal metin.',
    example: '120.50',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'unitCost sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  unitCost?: string;
}
