import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorDetail } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import {
  checkQuantity,
  quantityViolationMessage,
  toQuantityDecimal,
  toQuantityRules,
} from '../../common/utils/quantity-rules';

import type { InquiryItemInputDto } from './dto/inquiry.dto';

/**
 * Talep kalemlerinin doğrulanması — TEK BAĞLAYICI KAYNAK.
 *
 * Hem `POST /public/cart/validate` hem `POST /public/inquiries` buradan
 * geçer. İki ayrı yerde yazılsaydı doğrulama ucu "geçerli" derken
 * oluşturma ucu reddedebilirdi — kullanıcı için açıklanamaz bir durum.
 *
 * Kural 10: bu sınıf atlanamaz. Arayüzdeki (apps/web/src/lib/quantity.ts)
 * aynı kurallar yalnız kullanıcı deneyimi içindir.
 *
 * ONDALIK KIYASLAMA: `Prisma.Decimal` ile yapılır, JS float ile DEĞİL.
 * `(2.5 - 0.5) % 0.5` float'ta 0 yerine 0.49999...'a düşer ve geçerli bir
 * miktar reddedilirdi.
 */
@Injectable()
export class InquiryValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kalemleri doğrular ve talep yazımı için hazır satırları döndürür.
   *
   * Hata varsa TEK SEFERDE hepsi bildirilir: kullanıcı üç geçersiz
   * miktarı üç ayrı denemede öğrenmek zorunda kalmasın.
   */
  async validateItems(items: InquiryItemInputDto[]): Promise<ValidatedItem[]> {
    const details: ApiErrorDetail[] = [];
    const results: ValidatedItem[] = [];

    // Aynı varyasyon iki kez gönderilirse tek satırda birleştirilir:
    // aksi hâlde talepte aynı ürün iki satır olarak görünür ve mağaza
    // hangisinin geçerli olduğunu bilemez.
    const merged = mergeByVariant(items);

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: merged.map((item) => item.variantId) } },
      select: {
        id: true,
        sku: true,
        name: true,
        isActive: true,
        deletedAt: true,
        salePrice: true,
        unitQuantity: true,
        minOrderQuantity: true,
        quantityStep: true,
        maxOrderQuantity: true,
        stockQuantity: true,
        unitType: { select: { name: true, code: true, allowsDecimal: true } },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            isPublished: true,
            showPrice: true,
            deletedAt: true,
          },
        },
      },
    });

    const byId = new Map(variants.map((variant) => [variant.id, variant]));

    for (const [index, item] of merged.entries()) {
      const field = (name: string): string => `items[${index}].${name}`;
      const variant = byId.get(item.variantId);

      if (variant === undefined) {
        details.push({ field: field('variantId'), message: 'Ürün bulunamadı.' });
        continue;
      }

      // --- Yayın durumu ---
      if (!variant.isActive || variant.deletedAt !== null) {
        details.push({
          field: field('variantId'),
          message: `${variant.product.name}: bu satış birimi artık mevcut değil.`,
        });
        continue;
      }

      const product = variant.product;

      if (product.deletedAt !== null || !product.isActive || !product.isPublished) {
        details.push({
          field: field('variantId'),
          message: `${product.name}: ürün artık satışta değil.`,
        });
        continue;
      }

      // --- Miktar kuralları ---
      //
      // Kuralların KENDİSİ common/utils/quantity-rules.ts içindedir; burada
      // yalnız ihlal Türkçe mesaja çevrilir. Sepet birleştirmesi AYNI kuralı
      // farklı bir politikayla (reddetme yerine en yakın geçerli değere
      // ayarlama) uygular — bkz. o dosyanın başındaki açıklama.
      const quantity = toQuantityDecimal(item.quantity);

      if (quantity === null) {
        details.push({ field: field('quantity'), message: 'Miktar sıfırdan büyük olmalıdır.' });
        continue;
      }

      const unitLabel = variant.unitType.code;
      const violation = checkQuantity(quantity, toQuantityRules(variant));

      if (violation !== null) {
        details.push({
          field: field('quantity'),
          message: quantityViolationMessage(violation, unitLabel),
        });
        continue;
      }

      // --- Fiyat snapshot'ı ---
      //
      // Ürünün fiyatı gizliyse müşteri fiyatı GÖRMEDİ; kayda fiyat
      // yazmak sonradan "bu fiyatı görmüştü" yanılgısı üretir.
      const displayedPrice = product.showPrice ? new Prisma.Decimal(variant.salePrice) : null;

      results.push({
        variantId: variant.id,
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        variantName: variant.name,
        sku: variant.sku,
        unitTypeName: variant.unitType.name,
        unitQuantity: new Prisma.Decimal(variant.unitQuantity),
        quantity,
        displayedPrice,
        lineTotal: displayedPrice === null ? null : displayedPrice.times(quantity),
        note: item.note ?? null,
        // Stok bilgisi doğrulama yanıtında kullanıcıya gösterilir; TALEP
        // STOK REZERVE ETMEZ, bu yüzden stok yetersizliği HATA DEĞİLDİR.
        stockQuantity: new Prisma.Decimal(variant.stockQuantity),
      });
    }

    if (details.length > 0) {
      throw AppException.badRequest('Talep kalemleri geçersiz.', details);
    }

    return results;
  }

  /** Tahmini toplam — yalnız fiyatı gösterilen kalemlerden. */
  estimateTotal(items: ValidatedItem[]): Prisma.Decimal {
    return items.reduce(
      (total, item) => (item.lineTotal === null ? total : total.plus(item.lineTotal)),
      new Prisma.Decimal(0),
    );
  }
}

export interface ValidatedItem {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantName: string | null;
  sku: string;
  unitTypeName: string;
  unitQuantity: Prisma.Decimal;
  quantity: Prisma.Decimal;
  displayedPrice: Prisma.Decimal | null;
  lineTotal: Prisma.Decimal | null;
  note: string | null;
  stockQuantity: Prisma.Decimal;
}

/** Aynı varyasyonun tekrarlarını toplar. */
function mergeByVariant(items: InquiryItemInputDto[]): InquiryItemInputDto[] {
  const byVariant = new Map<string, InquiryItemInputDto>();

  for (const item of items) {
    const existing = byVariant.get(item.variantId);

    if (existing === undefined) {
      byVariant.set(item.variantId, { ...item });
      continue;
    }

    const sum = toQuantityDecimal(existing.quantity)?.plus(toQuantityDecimal(item.quantity) ?? 0);

    byVariant.set(item.variantId, {
      ...existing,
      quantity: sum === undefined || sum === null ? existing.quantity : sum.toString(),
      // İki notu birleştirmek karmaşa üretir; ilk not korunur.
      note: existing.note ?? item.note,
    });
  }

  return [...byVariant.values()];
}
