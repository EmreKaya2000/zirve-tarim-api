import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_SORT_ORDER,
  MAX_LIMIT,
  MIN_LIMIT,
  SORT_ORDERS,
  type SortOrder,
} from '@zirve/types';

/**
 * Tüm liste uçlarının ortak sorgu parametreleri — Kural 12, ARCHITECTURE §7.1.
 *
 * Modüller bu sınıftan türeyip kendi filtrelerini ekler. `sortBy` burada
 * serbest string'tir; her modül kendi DTO'sunda `@IsIn(...)` ile whitelist
 * uygular (SQL injection ve performans nedeniyle zorunludur).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Sayfa numarası (1 tabanlı).',
    minimum: DEFAULT_PAGE,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page bir tam sayı olmalıdır.' })
  @Min(DEFAULT_PAGE, { message: `page en az ${DEFAULT_PAGE} olmalıdır.` })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Sayfa başına kayıt sayısı.',
    minimum: MIN_LIMIT,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit bir tam sayı olmalıdır.' })
  @Min(MIN_LIMIT, { message: `limit en az ${MIN_LIMIT} olmalıdır.` })
  @Max(MAX_LIMIT, { message: `limit en fazla ${MAX_LIMIT} olabilir.` })
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Serbest metin arama. Aranan alanlar modüle göre değişir.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'search en fazla 200 karakter olabilir.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    description: 'Sıralama yönü.',
    enum: SORT_ORDERS,
    default: DEFAULT_SORT_ORDER,
  })
  @IsOptional()
  @IsIn(SORT_ORDERS, { message: `sortOrder yalnız ${SORT_ORDERS.join(' veya ')} olabilir.` })
  sortOrder: SortOrder = DEFAULT_SORT_ORDER;

  @ApiPropertyOptional({
    description: 'Başlangıç tarihi (ISO 8601, dahil).',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateFrom geçerli bir ISO 8601 tarihi olmalıdır.' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Bitiş tarihi (ISO 8601, dahil).',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateTo geçerli bir ISO 8601 tarihi olmalıdır.' })
  dateTo?: string;
}
