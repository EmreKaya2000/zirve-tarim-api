import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Ürünün türetilmiş fiyat aralığını yeniden hesaplar.
 *
 * `Product.minSalePrice` / `maxSalePrice` alanlarının TEK YAZICISIDIR.
 * Başka hiçbir yer bu kolonlara yazmaz — docs/ARCHITECTURE.md §13.1'deki
 * "tek yazıcı" ilkesi.
 *
 * Neden türetilmiş alan gerekiyor: fiyat varyasyonda, sıralama ve aralık
 * filtresi ürün düzeyinde. Prisma `MIN(variants.salePrice)` üzerinden
 * sıralayamaz; bellekte sıralamak yalnız o sayfayı sıralar ve sayfalamayı
 * yanlış yapar.
 *
 * Varyasyon ekleme/güncelleme/silme işlemlerinin AYNI transaction'ı içinde
 * çağrılır: yarım kalan bir işlem tutarsız fiyat bırakmamalıdır.
 */
@Injectable()
export class ProductPricingService {
  async recalculate(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const aggregate = await tx.productVariant.aggregate({
      where: { productId, isActive: true, deletedAt: null },
      _min: { salePrice: true },
      _max: { salePrice: true },
    });

    await tx.product.update({
      where: { id: productId },
      data: {
        // Aktif varyasyon kalmadıysa null olur; fiyat filtresi bu ürünü eler.
        minSalePrice: aggregate._min.salePrice,
        maxSalePrice: aggregate._max.salePrice,
      },
    });
  }

  /** Birden çok ürün için toplu yeniden hesaplama (seed ve bakım işleri). */
  async recalculateMany(tx: Prisma.TransactionClient, productIds: string[]): Promise<void> {
    for (const productId of productIds) {
      await this.recalculate(tx, productId);
    }
  }
}
