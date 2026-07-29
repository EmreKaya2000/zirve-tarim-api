import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from './pagination-query.dto';

/**
 * `"true"` / `"false"` sorgu parametresini boolean'a çevirir.
 *
 * Query string'de her şey metindir; `@Type(() => Boolean)` ise `"false"`
 * metnini `true`'ya çevirir (boş olmayan string truthy'dir). Bu dönüşüm
 * o tuzağı kapatır.
 */
export function BooleanQuery() {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return undefined;
  });
}

/**
 * Taksonomi listelerinin ortak sorgu parametreleri.
 *
 * `PaginationQueryDto`'ya aktiflik filtresi ekler. Modüller bundan türeyip
 * kendi `sortBy` whitelist'lerini ve ek filtrelerini tanımlar.
 *
 * @example
 * export class ListPlantsQueryDto extends BaseQueryDto {
 *   ＠IsIn(PLANT_SORT_FIELDS)
 *   sortBy: PlantSortField = 'sortOrder';
 * }
 */
export class BaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Aktiflik durumuna göre filtreler. Verilmezse tümü döner.',
    example: true,
  })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean({ message: 'isActive true veya false olmalıdır.' })
  isActive?: boolean;
}

/**
 * Taksonomi tablolarında ortak sıralama alanları.
 * Modüller bunu kendi alanlarıyla genişletebilir.
 */
export const LOOKUP_SORT_FIELDS = ['sortOrder', 'name', 'createdAt', 'updatedAt'] as const;

export type LookupSortField = (typeof LOOKUP_SORT_FIELDS)[number];

/** Taksonomi listeleri için hazır `sortBy` alanı taşıyan temel DTO. */
export class LookupQueryDto extends BaseQueryDto {
  @ApiPropertyOptional({
    enum: LOOKUP_SORT_FIELDS,
    default: 'sortOrder',
    description: 'Sıralama alanı. Yalnız listelenen değerler kabul edilir (K-74).',
  })
  @IsOptional()
  @IsIn(LOOKUP_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${LOOKUP_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: LookupSortField = 'sortOrder';

  /**
   * Taksonomi listelerinde varsayılan yön artan olmalıdır.
   *
   * Ortak DTO'da varsayılan `desc`'tir (en yeni kayıt üstte) ve bu, işlem
   * listeleri için doğrudur. Ancak sıra numarasına göre dizilen tanım
   * listelerinde `desc` sıralamayı ters çevirir.
   */
  override sortOrder: 'asc' | 'desc' = 'asc';
}
