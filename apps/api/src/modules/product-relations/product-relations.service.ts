import { Injectable } from '@nestjs/common';
import { AuditAction, ProductRelationType, type ProductRelation } from '@prisma/client';
import { ERROR_CODES, isSymmetricRelation } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateRelationDto } from './dto/relation.dto';

const ENTITY_TYPE = 'ProductRelation';

/** Bir ilişkinin listede gösterilen hâli. */
export interface RelationView {
  id: string;
  type: ProductRelationType;
  note: string | null;
  sortOrder: number;
  /** Karşı taraftaki ürün. */
  product: { id: string; name: string; slug: string; imageUrl: string | null };
  /**
   * Bu ilişkide bu ürün kaynak mı?
   *
   * Yönlü ilişkilerde önemlidir: kaynak değilsek ilişkiyi bu üründen
   * yönetemeyiz (silmek için karşı ürünün sayfasına gitmek gerekir).
   */
  isSource: boolean;
}

/**
 * Ürünler arası ilişki yönetimi.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SAKLAMA KARARI (docs/ARCHITECTURE.md §13.2'nin Sprint 4 genişletmesi)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * İKİ AİLE VARDIR ve saklama biçimleri FARKLIDIR:
 *
 * ── SİMETRİK: COMPATIBLE, INCOMPATIBLE, SIMILAR ──
 *   "A, B ile uyumsuzdur" = "B, A ile uyumsuzdur". Aynı gerçeğin iki
 *   ifadesidir. TEK satır saklanır ve `sourceProductId < targetProductId`
 *   kanonik sıralaması DB CHECK ile ZORUNLU tutulur.
 *
 *   NEDEN tek satır: iki ayna satır tutulsaydı biri silinip diğeri
 *   kalabilirdi. INCOMPATIBLE'da bu bir GÜVENLİK hatasıdır — çiftçi bir
 *   ürünün sayfasında uyarıyı görür, diğerinde görmez ve iki ilacı tankta
 *   karıştırır. Tek satırda ayrışma FİZİKSEL OLARAK imkânsızdır.
 *
 *   Okuma iki yönü birden tarar (`OR` + iki index).
 *
 * ── YÖNLÜ: ALTERNATIVE, COMPLEMENTARY, RECOMMENDED_TOGETHER ──
 *   "A yerine B önerilir" ifadesi tersine çevrilemez. Pahalı bir ürünün
 *   alternatifi ucuz olabilir; tersini önermek mağazanın istemeyeceği bir
 *   davranıştır. Kaynak → hedef olarak saklanır, sıralama kısıtı yoktur.
 *
 *   Okuma yalnız `sourceProductId` üzerinden yapılır.
 * ═══════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class ProductRelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Bir ürünün ilişkilerini listeler. */
  async findMany(productId: string, type?: ProductRelationType): Promise<RelationView[]> {
    await this.assertProductExists(productId);

    const relations = await this.prisma.productRelation.findMany({
      where: {
        ...(type !== undefined && { type }),
        OR: [{ sourceProductId: productId }, { targetProductId: productId }],
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
      include: {
        sourceProduct: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        targetProduct: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
      },
    });

    return relations
      .filter((relation) => {
        // YÖNLÜ ilişkide yalnız kaynak taraf gösterilir: "A yerine B" bilgisi
        // B'nin sayfasında "B yerine A" anlamına gelmez.
        if (isSymmetricRelation(relation.type)) {
          return true;
        }

        return relation.sourceProductId === productId;
      })
      .map((relation) => {
        const isSource = relation.sourceProductId === productId;
        const other = isSource ? relation.targetProduct : relation.sourceProduct;

        return {
          id: relation.id,
          type: relation.type,
          note: relation.note,
          sortOrder: relation.sortOrder,
          isSource,
          product: {
            id: other.id,
            name: other.name,
            slug: other.slug,
            imageUrl: other.images[0]?.url ?? null,
          },
        };
      });
  }

  async create(
    productId: string,
    dto: CreateRelationDto,
    actor: ActorContext,
  ): Promise<ProductRelation> {
    await this.assertProductExists(productId);
    await this.assertProductExists(dto.targetProductId, 'Hedef ürün bulunamadı.');

    // Ürün kendisiyle ilişkilendirilemez (SPEC §15). DB CHECK son savunmadır;
    // buradaki kontrol kullanıcıya anlamlı mesaj verir.
    if (productId === dto.targetProductId) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Bir ürün kendisiyle ilişkilendirilemez.',
        422,
        [{ field: 'targetProductId', message: 'Kaynak ve hedef ürün aynı olamaz.' }],
      );
    }

    // INCOMPATIBLE'da gerekçe ZORUNLUDUR: "birlikte kullanmayın" uyarısı
    // nedenini söylemiyorsa çiftçi onu ciddiye almaz.
    if (dto.type === ProductRelationType.INCOMPATIBLE) {
      const note = dto.note?.trim();

      if (note === undefined || note.length === 0) {
        throw new AppException(
          ERROR_CODES.UNPROCESSABLE,
          'Uyumsuzluk ilişkisinde gerekçe zorunludur.',
          422,
          [
            {
              field: 'note',
              message: 'Bu iki ürünün neden birlikte kullanılmaması gerektiğini yazın.',
            },
          ],
        );
      }
    }

    const [sourceId, targetId] = this.orderPair(productId, dto.targetProductId, dto.type);

    await this.assertNotDuplicate(sourceId, targetId, dto.type);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.productRelation.create({
        data: {
          sourceProductId: sourceId,
          targetProductId: targetId,
          type: dto.type,
          note: dto.note ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: { type: dto.type, sourceId, targetId },
        description: `Ürün ilişkisi eklendi: ${dto.type}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });
  }

  async remove(productId: string, relationId: string, actor: ActorContext): Promise<void> {
    const relation = await this.prisma.productRelation.findFirst({
      where: {
        id: relationId,
        OR: [{ sourceProductId: productId }, { targetProductId: productId }],
      },
    });

    if (relation === null) {
      throw AppException.notFound('İlişki bulunamadı.');
    }

    // YÖNLÜ ilişki yalnız KAYNAK üründen silinebilir: hedef üründen silmek,
    // sahibi olmadığın bir öneriyi kaldırmak olurdu.
    if (!isSymmetricRelation(relation.type) && relation.sourceProductId !== productId) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Bu yönlü ilişki yalnızca kaynak ürün üzerinden kaldırılabilir.',
        422,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productRelation.delete({ where: { id: relationId } });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.DELETE,
        entityType: ENTITY_TYPE,
        entityId: relationId,
        oldData: {
          type: relation.type,
          sourceId: relation.sourceProductId,
          targetId: relation.targetProductId,
        },
        description: `Ürün ilişkisi kaldırıldı: ${relation.type}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  /**
   * Kaynak/hedef sırasını belirler.
   *
   * SİMETRİK türlerde kanonik sıra uygulanır (küçük id kaynak olur) —
   * böylece aynı çift ters yönde ikinci kez yazılamaz ve DB CHECK geçer.
   * YÖNLÜ türlerde verilen sıra korunur; yön anlamın kendisidir.
   */
  private orderPair(
    productId: string,
    targetId: string,
    type: ProductRelationType,
  ): [string, string] {
    if (!isSymmetricRelation(type)) {
      return [productId, targetId];
    }

    return productId < targetId ? [productId, targetId] : [targetId, productId];
  }

  private async assertNotDuplicate(
    sourceId: string,
    targetId: string,
    type: ProductRelationType,
  ): Promise<void> {
    const existing = await this.prisma.productRelation.findFirst({
      where: { sourceProductId: sourceId, targetProductId: targetId, type },
      select: { id: true },
    });

    if (existing !== null) {
      throw new AppException(ERROR_CODES.CONFLICT, 'Bu ilişki zaten tanımlı.', 409);
    }
  }

  private async assertProductExists(id: string, message = 'Ürün bulunamadı.'): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (product === null) {
      throw AppException.notFound(message);
    }
  }
}
