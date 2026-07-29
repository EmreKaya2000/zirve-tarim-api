import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, type ProductImage } from '@prisma/client';
import { ERROR_CODES } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.interface';

const ENTITY_TYPE = 'ProductImage';

/** İzin verilen görsel MIME tipleri. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Azami dosya boyutu (bayt). 5 MB. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Ürün başına azami görsel sayısı. */
export const MAX_IMAGES_PER_PRODUCT = 12;

/**
 * Dosya imzaları (magic bytes).
 *
 * MIME tipi İSTEMCİDEN GELİR ve kolayca yalan söylenebilir: `.php` dosyasına
 * `image/jpeg` başlığı takılabilir. Gerçek koruma dosyanın ilk baytlarını
 * okumaktır (docs/ARCHITECTURE.md §11.1).
 */
const MAGIC_BYTES: { mime: string; check: (buffer: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    check: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    check: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    // "RIFF" .... "WEBP"
    check: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Multer'ın verdiği dosya. */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Ürüne bir veya daha fazla görsel yükler. */
  async uploadProductImages(
    productId: string,
    files: UploadedFileLike[],
    actor: ActorContext,
  ): Promise<ProductImage[]> {
    await this.assertProductExists(productId);

    if (files.length === 0) {
      throw AppException.badRequest('Yüklenecek dosya bulunamadı.');
    }

    const existingCount = await this.prisma.productImage.count({ where: { productId } });

    if (existingCount + files.length > MAX_IMAGES_PER_PRODUCT) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        `Bir ürüne en fazla ${MAX_IMAGES_PER_PRODUCT} görsel eklenebilir. Şu an ${existingCount} görsel var.`,
        422,
      );
    }

    for (const file of files) {
      this.assertValidImage(file);
    }

    // Dosyalar önce diske yazılır, sonra kayıtlar tek transaction'da atılır.
    //
    // Ters sıra (önce kayıt, sonra disk) transaction geri alınırsa yetim
    // DOSYA bırakırdı. Bu sırada ise en kötü durumda yetim dosya kalır ama
    // veritabanı tutarlıdır — temizlenmesi kolay olan taraf budur.
    const stored = await Promise.all(
      files.map((file) =>
        this.storage.save(
          {
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
          'products',
        ),
      ),
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const hasPrimary =
          (await tx.productImage.count({ where: { productId, isPrimary: true } })) > 0;

        const created: ProductImage[] = [];

        for (const [index, file] of stored.entries()) {
          created.push(
            await tx.productImage.create({
              data: {
                productId,
                storageKey: file.storageKey,
                url: file.url,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                originalName: files[index]?.originalname ?? null,
                width: file.width ?? null,
                height: file.height ?? null,
                sortOrder: existingCount + index,
                // İlk görsel otomatik olarak ana görsel olur.
                isPrimary: !hasPrimary && index === 0,
              },
            }),
          );
        }

        await this.auditLogs.record(tx, {
          userId: actor.id,
          action: AuditAction.CREATE,
          entityType: ENTITY_TYPE,
          entityId: productId,
          newData: { count: created.length },
          description: `${created.length} ürün görseli yüklendi.`,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });

        return created;
      });
    } catch (error) {
      // Kayıt başarısızsa diskteki dosyalar temizlenir.
      await Promise.all(stored.map((file) => this.storage.delete(file.storageKey)));

      throw error;
    }
  }

  async deleteProductImage(productId: string, imageId: string, actor: ActorContext): Promise<void> {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });

    if (image === null) {
      throw AppException.notFound('Görsel bulunamadı.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      // Ana görsel silindiyse sıradaki görsel ana görsel yapılır: ürünün
      // kartsız kalmaması için.
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });

        if (next !== null) {
          await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.DELETE,
        entityType: ENTITY_TYPE,
        entityId: imageId,
        oldData: { url: image.url, originalName: image.originalName },
        description: 'Ürün görseli silindi.',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    // Kayıt silindikten SONRA dosya silinir: dosya silinip kayıt kalırsa
    // kırık görsel gösterilir, tersi yalnız yetim dosya bırakır.
    await this.storage.delete(image.storageKey);
  }

  /** Görselleri verilen sıraya göre yeniden dizer. */
  async reorderImages(
    productId: string,
    imageIds: string[],
    actor: ActorContext,
  ): Promise<ProductImage[]> {
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });

    const existingIds = new Set(images.map((image) => image.id));
    const unknown = imageIds.filter((id) => !existingIds.has(id));

    if (unknown.length > 0) {
      throw AppException.badRequest('Sıralama listesinde bu ürüne ait olmayan görsel var.');
    }

    if (imageIds.length !== images.length) {
      throw AppException.badRequest(
        `Sıralama listesi eksik: ${images.length} görsel bekleniyor, ${imageIds.length} geldi.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const [index, imageId] of imageIds.entries()) {
        await tx.productImage.update({ where: { id: imageId }, data: { sortOrder: index } });
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: productId,
        description: 'Görsel sırası değiştirildi.',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return tx.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
    });
  }

  /** Ana görseli değiştirir. */
  async setPrimaryImage(
    productId: string,
    imageId: string,
    actor: ActorContext,
  ): Promise<ProductImage> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true },
    });

    if (image === null) {
      throw AppException.notFound('Görsel bulunamadı.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Kısmi unique index nedeniyle önce eskisi temizlenmeli.
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });

      const updated = await tx.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: imageId,
        description: 'Ana görsel değiştirildi.',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Dosya doğrulaması.
   *
   * ÜÇ KATMAN: boyut, bildirilen MIME tipi ve GERÇEK içerik imzası.
   * Üçüncüsü olmadan `.php` dosyası `image/jpeg` başlığıyla yüklenebilir.
   */
  private assertValidImage(file: UploadedFileLike): void {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        `Dosya çok büyük: ${file.originalname}. En fazla ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB.`,
        422,
        [{ field: 'file', message: 'Dosya boyutu sınırı aşıldı.' }],
      );
    }

    if (file.size === 0) {
      throw AppException.badRequest(`Boş dosya: ${file.originalname}`);
    }

    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        `Desteklenmeyen dosya tipi: ${file.mimetype}. Yalnız JPG, PNG ve WebP kabul edilir.`,
        422,
        [{ field: 'file', message: 'Yalnız JPG, PNG ve WebP yükleyebilirsiniz.' }],
      );
    }

    const signature = MAGIC_BYTES.find((entry) => entry.check(file.buffer));

    if (signature === undefined || signature.mime !== file.mimetype) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        `Dosya içeriği bildirilen tiple uyuşmuyor: ${file.originalname}`,
        422,
        [{ field: 'file', message: 'Dosya gerçek bir görsel değil.' }],
      );
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });

    if (product === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }
  }
}
