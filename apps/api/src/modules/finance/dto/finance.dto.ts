import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TOP_LIST_LIMIT } from '@zirve/types';

/**
 * Rapor tarih aralığı.
 *
 * İKİSİ DE OPSİYONELDİR ve verilmezse İÇİNDE BULUNULAN AY kullanılır —
 * varsayılanı "tüm zamanlar" yapmak, veri büyüdükçe her rapor açılışını
 * tam tablo taramasına çevirirdi.
 *
 * Tarihler UTC kabul edilir (Kural 3); gün sınırına çevirmek sunum
 * katmanının işidir.
 */
export class ReportRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Başlangıç (ISO 8601, dahil). Verilmezse içinde bulunulan ayın ilk günü.',
    example: '2026-07-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateFrom geçerli bir ISO 8601 tarihi olmalıdır.' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Bitiş (ISO 8601, dahil). Verilmezse içinde bulunulan ayın son günü.',
    example: '2026-07-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateTo geçerli bir ISO 8601 tarihi olmalıdır.' })
  dateTo?: string;
}

/** "En çok" listeleri için satır sınırı. */
export class TopListQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ default: TOP_LIST_LIMIT, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit bir tam sayı olmalıdır.' })
  @Min(1)
  @Max(50, { message: 'limit en fazla 50 olabilir.' })
  limit: number = TOP_LIST_LIMIT;
}

export const OVERDUE_SORT_FIELDS = ['dueDate', 'remainingTotal'] as const;

export type OverdueSortField = (typeof OVERDUE_SORT_FIELDS)[number];

/** Vadesi geçenler listesi sorgusu. */
export class OverdueQueryDto {
  @ApiPropertyOptional({ enum: OVERDUE_SORT_FIELDS, default: 'dueDate' })
  @IsOptional()
  @IsIn(OVERDUE_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${OVERDUE_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: OverdueSortField = 'dueDate';

  @ApiPropertyOptional({
    description: 'En az kaç gün gecikmiş olanlar gösterilsin.',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minDaysOverdue: number = 1;
}
