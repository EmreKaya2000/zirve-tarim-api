import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import type { PaginationMeta } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';

import { ADMIN_STOCK_LIST_SELECT, ADMIN_STOCK_MOVEMENT_SELECT } from './stock.select';
import {
  STOCK_MOVEMENT_SORT_FIELDS,
  STOCK_SORT_FIELDS,
  type StockMovementQueryDto,
  type StockQueryDto,
} from './dto/stock.dto';

/** Stok listesi meta'sı sayfalamaya ek olarak kritik stok sayacını taşır. */
export interface StockListMeta extends PaginationMeta {
  /** Aynı filtre altında kritik eşiğin altına düşmüş varyasyon sayısı. */
  lowStockCount: number;
  /** Aynı filtre altında stoğu sıfırlanmış varyasyon sayısı. */
  outOfStockCount: number;
}

/**
 * Stok okuma servisi.
 *
 * YAZMA YOKTUR: stok yalnız `StockService.applyMovement()` üzerinden
 * değişir. Okuma ve yazmanın ayrı sınıflarda durması, "stoğu kim
 * değiştirebilir" sorusunun yanıtını tek dosyaya indirger.
 */
@Injectable()
export class StockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBuilder: QueryBuilderService,
  ) {}

  /** Varyasyon bazlı stok listesi. */
  async findVariants(query: StockQueryDto): Promise<{ items: unknown[]; meta: StockListMeta }> {
    const where = this.buildVariantWhere(query);

    const [items, total, lowStockCount, outOfStockCount] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        ...this.queryBuilder.build(query, where, STOCK_SORT_FIELDS, 'stockQuantity'),
        select: ADMIN_STOCK_LIST_SELECT,
      }),
      this.prisma.productVariant.count({ where }),
      this.prisma.productVariant.count({ where: { AND: [where, this.lowStockCondition()] } }),
      this.prisma.productVariant.count({
        where: { AND: [where, { trackStock: true, stockQuantity: { lte: 0 } }] },
      }),
    ]);

    return {
      items,
      meta: { ...this.queryBuilder.buildMeta(total, query), lowStockCount, outOfStockCount },
    };
  }

  /**
   * Kritik stok listesi — `stockQuantity <= lowStockThreshold`.
   *
   * Eşiği 0 olan varyasyonlar da listeye girer: stoğu sıfırlanmış bir ürün
   * eşik tanımlanmamış olsa bile kritiktir. Uyarı istenmeyen kalemler için
   * doğru araç `trackStock = false`'tur.
   */
  async findLowStock(query: StockQueryDto): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const where: Prisma.ProductVariantWhereInput = {
      AND: [this.buildVariantWhere({ ...query, trackStock: true }), this.lowStockCondition()],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        ...this.queryBuilder.build(query, where, STOCK_SORT_FIELDS, 'stockQuantity'),
        select: ADMIN_STOCK_LIST_SELECT,
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  /** Filtreli hareket geçmişi. */
  async findMovements(
    query: StockMovementQueryDto,
  ): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const where = this.buildMovementWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        ...this.queryBuilder.build(query, where, STOCK_MOVEMENT_SORT_FIELDS, 'createdAt'),
        select: ADMIN_STOCK_MOVEMENT_SELECT,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  // ==========================================================================
  // FİLTRELER
  // ==========================================================================

  private buildVariantWhere(query: StockQueryDto): Prisma.ProductVariantWhereInput {
    const conditions: Prisma.ProductVariantWhereInput[] = [];

    // Silinmiş varyasyon ve silinmiş ürün varsayılan olarak GİZLENİR: stok
    // listesi "rafta ne var" sorusunu yanıtlar, arşivi değil.
    if (query.includeInactive !== true) {
      conditions.push({ deletedAt: null, isActive: true, product: { deletedAt: null } });
    } else {
      conditions.push({ product: { deletedAt: null } });
    }

    if (query.productId !== undefined) {
      conditions.push({ productId: query.productId });
    }

    if (query.categoryId !== undefined) {
      conditions.push({ product: { categories: { some: { categoryId: query.categoryId } } } });
    }

    if (query.brandId !== undefined) {
      conditions.push({ product: { brandId: query.brandId } });
    }

    if (query.trackStock !== undefined) {
      conditions.push({ trackStock: query.trackStock });
    }

    if (query.lowStockOnly === true) {
      conditions.push({ trackStock: true }, this.lowStockCondition());
    }

    const term = query.search?.trim();

    if (term !== undefined && term !== '') {
      conditions.push({
        OR: [
          { sku: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
          { product: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }

    return { AND: conditions };
  }

  private buildMovementWhere(query: StockMovementQueryDto): Prisma.StockMovementWhereInput {
    const conditions: Prisma.StockMovementWhereInput[] = [];

    if (query.variantId !== undefined) {
      conditions.push({ variantId: query.variantId });
    }

    if (query.productId !== undefined) {
      conditions.push({ productId: query.productId });
    }

    const types = (query.type ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is StockMovementType => value in StockMovementType);

    if (types.length > 0) {
      conditions.push({ type: { in: types } });
    }

    if (query.direction !== undefined) {
      conditions.push({ direction: query.direction });
    }

    if (query.referenceType !== undefined) {
      conditions.push({ referenceType: query.referenceType });
    }

    if (query.referenceId !== undefined) {
      conditions.push({ referenceId: query.referenceId });
    }

    const createdAt = this.queryBuilder.buildDateRange(query.dateFrom, query.dateTo);

    if (createdAt !== undefined) {
      conditions.push({ createdAt });
    }

    const term = query.search?.trim();

    if (term !== undefined && term !== '') {
      conditions.push({
        OR: [
          { description: { contains: term, mode: 'insensitive' } },
          { variant: { sku: { contains: term, mode: 'insensitive' } } },
          { product: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }

    return conditions.length === 0 ? {} : { AND: conditions };
  }

  /**
   * Kritik stok koşulu: `stockQuantity <= lowStockThreshold`.
   *
   * İki KOLONUN karşılaştırılması Prisma'nın alan referansı (`fields`)
   * özelliğiyle yapılır; ham SQL'e düşmeden aynı koşul hem listede hem
   * sayaçta yeniden kullanılabilsin diye tek yerde tanımlıdır.
   */
  private lowStockCondition(): Prisma.ProductVariantWhereInput {
    return { stockQuantity: { lte: this.prisma.productVariant.fields.lowStockThreshold } };
  }
}
