import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '@zirve/types';

import type { PaginationQueryDto } from '../dto/pagination-query.dto';

/** Sıralama yönü. */
export type SortOrder = 'asc' | 'desc';

/** `findMany`/`count` çiftine geçirilecek hazır sorgu parçaları. */
export interface QueryParts<TWhere> {
  where: TWhere;
  skip: number;
  take: number;
  orderBy: Record<string, SortOrder>;
}

/**
 * Liste sorgusu kurma yardımcıları.
 *
 * TÜM liste uçları bu servisi kullanır (Kural 12). Amaç, her modülde
 * sayfalama/arama/sıralama mantığının yeniden yazılmasını önlemek ve
 * davranışın her yerde AYNI olmasını garanti etmek.
 *
 * Güvenlik notu: `orderBy` alanı hiçbir zaman doğrudan istemciden gelen
 * string ile kurulmaz. Modülün DTO'su `@IsIn(...)` ile whitelist uygular;
 * burada ayrıca ikinci bir kontrol yapılır (K-74).
 */
@Injectable()
export class QueryBuilderService {
  /**
   * Sorgu parçalarını üretir.
   *
   * @param query      Ortak sorgu parametreleri (page, limit, sortBy...)
   * @param where      Modüle özgü filtre
   * @param sortFields Sıralamaya izin verilen alanlar (whitelist)
   * @param fallbackSortField Whitelist dışı bir değer gelirse kullanılacak alan
   */
  build<TWhere>(
    query: PaginationQueryDto,
    where: TWhere,
    sortFields: readonly string[],
    fallbackSortField: string,
  ): QueryParts<TWhere> {
    const { skip, take } = toSkipTake(query.page, query.limit);

    return {
      where,
      skip,
      take,
      orderBy: this.buildOrderBy(query, sortFields, fallbackSortField),
    };
  }

  /**
   * Sıralama nesnesini üretir; alan whitelist dışındaysa yedek alana düşer.
   *
   * DTO doğrulaması zaten geçersiz değeri reddeder; buradaki kontrol
   * savunma amaçlıdır — servis doğrudan çağrılırsa da güvenli kalır.
   */
  buildOrderBy(
    query: PaginationQueryDto,
    sortFields: readonly string[],
    fallbackSortField: string,
  ): Record<string, SortOrder> {
    const requested = (query as PaginationQueryDto & { sortBy?: string }).sortBy;
    const field =
      requested !== undefined && sortFields.includes(requested) ? requested : fallbackSortField;

    return { [field]: query.sortOrder };
  }

  /** Sonuç ve toplamdan standart `meta` üretir. */
  buildMeta(total: number, query: PaginationQueryDto): PaginationMeta {
    return buildPaginationMeta(total, query.page, query.limit);
  }

  /**
   * Birden çok alanda büyük/küçük harf duyarsız arama filtresi kurar.
   *
   * Arama terimi boşsa `undefined` döner; çağıran koşullu olarak ekler.
   */
  buildSearch(
    search: string | undefined,
    fields: readonly string[],
  ): { OR: Record<string, Prisma.StringFilter>[] } | undefined {
    const term = search?.trim();

    if (term === undefined || term.length === 0 || fields.length === 0) {
      return undefined;
    }

    return {
      OR: fields.map((field) => ({
        [field]: { contains: term, mode: 'insensitive' as const },
      })),
    };
  }

  /**
   * Tarih aralığı filtresi kurar. İki uç da tanımsızsa `undefined` döner.
   *
   * Tarihler UTC kabul edilir (Kural 3); yerel gün sınırına çevirmek
   * sunum katmanının işidir.
   */
  buildDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (from === undefined && to === undefined) {
      return undefined;
    }

    return {
      ...(from !== undefined && { gte: new Date(from) }),
      ...(to !== undefined && { lte: new Date(to) }),
    };
  }
}
