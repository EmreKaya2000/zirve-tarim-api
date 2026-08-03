import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, type ProductImage } from '@prisma/client';
import { ERROR_CODES } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.interface';

import { assertValidImageFile, type UploadedFileLike } from './image-validation';

/*
 * Geriye dönük yeniden dışa aktarım: controller ve testler bu isimleri
 * `uploads.service`ten alıyor. Tanım artık `image-validation` dosyasında —
 * kategori ikonu da aynı doğrulamayı kullanıyor.
 */
export { ALLOWED_IMAGE_MIME_TYPES, type UploadedFileLike } from './image-validation';

const ENTITY_TYPE = 'ProductImage';

/** Azami dosya boyutu (bayt). 5 MB. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Ürün başına azami görsel sayısı. */
export const MAX_IMAGES_PER_PRODUCT = 12;

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
  /** Ortak doğrulama; sınır ürün görseli için 5 MB. */
  private assertValidImage(file: UploadedFileLike): void {
    assertValidImageFile(file, MAX_IMAGE_SIZE_BYTES);
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
