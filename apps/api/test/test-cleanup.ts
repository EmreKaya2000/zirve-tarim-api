import type { PrismaClient } from '@prisma/client';

/**
 * Test ürünlerini stok geçmişiyle birlikte siler.
 *
 * NEDEN AYRI BİR YARDIMCI GEREKİYOR:
 *
 * `stock_movements` DEĞİŞMEZ bir tablodur — UPDATE ve DELETE veritabanı
 * RULE'u ile engellenir (Sprint 9 migration'ı, K-63). Bu yüzden varyasyona
 * giden yabancı anahtar `ON DELETE NO ACTION`'dır: stok geçmişi olan bir
 * varyasyon hard delete EDİLEMEZ.
 *
 * Üretimde doğru davranış budur (uygulama zaten soft delete kullanır) ama
 * testler kendi verisini gerçekten silmek zorundadır. Çözüm `audit_logs`
 * için kullanılanla aynı: kuralı geçici olarak devre dışı bırak, sil, geri aç.
 *
 * Kural `finally` içinde geri açılır — bir silme hatası, sonraki testleri
 * korumasız bir tabloyla baş başa bırakmamalıdır.
 */
export async function deleteProductsWithStockHistory(
  prisma: PrismaClient,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) {
    return;
  }

  await prisma.$executeRawUnsafe(
    'ALTER TABLE stock_movements DISABLE RULE stock_movements_no_delete',
  );

  try {
    await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE stock_movements ENABLE RULE stock_movements_no_delete',
    );
  }
}
