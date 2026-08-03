import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ERROR_CODES } from '@zirve/types';
import sharp from 'sharp';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/actor-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.interface';
import { assertValidImageFile, type UploadedFileLike } from './image-validation';

const ENTITY_TYPE = 'CategoryIcon';

/**
 * =============================================================================
 * KATEGORİ İKONU — YÜKLEME KISITLARI
 * =============================================================================
 * İkon, ürün görselinden FARKLI bir şeydir: kategori listesinde ~40 px,
 * kategori sayfasında ~64 px kutuda görünür. Bu yüzden sınırlar da farklı.
 *
 * ÜST SINIR 1 MB (ürün görselinde 5 MB). 1 MB'ı aşan bir dosya ikon değil
 * fotoğraftır. Erken reddetmek sharp'ı hiç çalıştırmadan kurtarır.
 */
export const MAX_ICON_SIZE_BYTES = 1024 * 1024;

/**
 * ALT SINIR 64×64. Bunun altındaki bir görsel 64 px kutuda büyütülür ve
 * bulanık çıkar; sonradan düzeltmenin yolu yoktur, dosya zaten o kadar
 * bilgi taşımıyordur.
 */
export const MIN_ICON_DIMENSION = 64;

/**
 * ÜST SINIR 2048×2048 — sıkıştırma bombasına karşı.
 * 20000×20000 tek renk bir PNG diskte küçüktür ama açıldığında yüzlerce MB
 * bellek ister. `limitInputPixels` ikinci katman olarak ayrıca kurulur.
 */
export const MAX_ICON_DIMENSION = 2048;

/**
 * KARE OLMA TOLERANSI. İkon kutusu karedir; 3:1 bir banner o kutuda
 * şeritleşir ve bozuk görünür. Tam kare şartı ise fazla katı: dışa aktarılan
 * PNG'lerde 1-2 px asimetri sık görülür. Uzun kenar kısa kenarın 1.25
 * katından fazlaysa reddedilir.
 */
export const MAX_ICON_ASPECT_RATIO = 1.25;

/**
 * ÇIKTI 128×128 WebP.
 *
 * Neden 128: en büyük kullanım 64 px, 2× ekranda 128 px eder. Daha büyüğünü
 * saklamak yalnız yer ve bant genişliği harcar.
 *
 * Neden `contain` (kırpma DEĞİL): ikonu kırpmak anlamlı kısmı kesebilir.
 * `contain` görselin tamamını korur, boşluğu ŞEFFAF doldurur.
 *
 * Neden WebP: alfa kanalını destekler ve aynı kalitede PNG'den belirgin
 * küçüktür.
 */
const ICON_OUTPUT_SIZE = 128;
const ICON_OUTPUT_QUALITY = 90;

/** sharp'a verilen giriş piksel tavanı (bomba savunması). */
const SHARP_PIXEL_LIMIT = MAX_ICON_DIMENSION * MAX_ICON_DIMENSION;

/**
 * Kategori ikonu yükleme ve silme.
 *
 * NEDEN AYRI SERVİS: `UploadsService` ürün görsel galerisini yönetiyor
 * (sıralama, ana görsel, adet sınırı). İkon tek dosyalık, sıralaması olmayan
 * ve BOYUT NORMALLEŞTİRMESİ gerektiren farklı bir iş. Aynı sınıfa koymak iki
 * ayrı sorumluluğu birleştirirdi; doğrulama ise `image-validation` üzerinden
 * PAYLAŞILIYOR, kopyalanmıyor.
 *
 * SVG BİLEREK KABUL EDİLMEZ — ve bu en çok sorulacak karardır:
 *   1. SVG bir XML belgesidir; `<script>`, `onload` ve dış varlık referansı
 *      taşıyabilir. Kendi alan adımızdan servis edilen bir SVG, saklanmış
 *      XSS'e dönüşür.
 *   2. Doğru temizlemek ayrı bir bağımlılık ve kolayca yanlış yapılan bir iş.
 *   3. SVG'nin magic byte'ı yoktur; mevcut üç katmanlı doğrulama (boyut +
 *      bildirilen MIME + gerçek içerik imzası) ona uygulanamaz, yani tek
 *      istisna için ikinci bir doğrulama modeli gerekirdi.
 * İkonun keskinliği 128 px WebP ile fiilen yeterli olduğu için kazanç bu
 * riski karşılamıyor.
 */
@Injectable()
export class CategoryIconService {
  private readonly logger = new Logger(CategoryIconService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Kategoriye ikon yükler; varsa öncekini siler. */
  async upload(
    categoryId: string,
    file: UploadedFileLike | undefined,
    actor: ActorContext,
  ): Promise<{ iconUrl: string }> {
    if (file === undefined) {
      throw AppException.badRequest('Dosya gönderilmedi.', [
        { field: 'file', message: 'Bir ikon görseli seçin.' },
      ]);
    }

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true, name: true, iconStorageKey: true },
    });

    if (category === null) {
      throw AppException.notFound('Kategori bulunamadı.');
    }

    assertValidImageFile(file, MAX_ICON_SIZE_BYTES);

    const normalized = await this.normalizeToIcon(file);

    const stored = await this.storage.save(
      {
        buffer: normalized,
        originalName: `${categoryId}-icon.webp`,
        mimeType: 'image/webp',
        size: normalized.byteLength,
      },
      'categories',
    );

    /*
     * ÖNCEKİ DOSYA VERİTABANI GÜNCELLENDİKTEN SONRA SİLİNİR.
     *
     * Ters sırada silinip güncelleme başarısız olursa kategori var olmayan
     * bir dosyayı gösterirdi — kırık görsel. Bu sırada en kötü durum yetim
     * bir dosyadır: yer kaplar ama hiçbir şeyi bozmaz.
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: categoryId },
        data: { iconUrl: stored.url, iconStorageKey: stored.storageKey },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: categoryId,
        oldData: { iconStorageKey: category.iconStorageKey },
        newData: { iconStorageKey: stored.storageKey, sizeBytes: normalized.byteLength },
        description: `Kategori ikonu yüklendi: ${category.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    if (category.iconStorageKey !== null) {
      await this.storage.delete(category.iconStorageKey);
    }

    this.logger.log(`Kategori ikonu yüklendi: ${category.name} (${normalized.byteLength} B)`);

    return { iconUrl: stored.url };
  }

  /** Kategorinin ikonunu kaldırır. */
  async remove(categoryId: string, actor: ActorContext): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true, name: true, iconStorageKey: true },
    });

    if (category === null) {
      throw AppException.notFound('Kategori bulunamadı.');
    }

    if (category.iconStorageKey === null) {
      throw AppException.badRequest('Bu kategoride ikon yok.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: categoryId },
        data: { iconUrl: null, iconStorageKey: null },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: categoryId,
        oldData: { iconStorageKey: category.iconStorageKey },
        newData: { iconStorageKey: null },
        description: `Kategori ikonu kaldırıldı: ${category.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    await this.storage.delete(category.iconStorageKey);
  }

  /**
   * Görseli ikon biçimine getirir: boyut kurallarını denetler, 128×128 WebP
   * üretir, METADATA'YI ATAR.
   *
   * Metadata atmak bir gizlilik gereğidir: telefonla çekilmiş bir görselin
   * EXIF'i GPS konumu ve cihaz bilgisi taşır ve ikon HERKESE AÇIK bir
   * varlıktır. `rotate()` metadata atılmadan ÖNCE çağrılır; yoksa EXIF
   * yönlendirmesi kaybolur ve görsel yan döner.
   */
  private async normalizeToIcon(file: UploadedFileLike): Promise<Buffer> {
    const image = sharp(file.buffer, { limitInputPixels: SHARP_PIXEL_LIMIT });

    let width: number | undefined;
    let height: number | undefined;

    try {
      const metadata = await image.metadata();

      width = metadata.width;
      height = metadata.height;
    } catch {
      throw this.unprocessable('Görsel okunamadı; dosya bozuk olabilir.', 'Görsel okunamadı.');
    }

    if (width === undefined || height === undefined) {
      throw this.unprocessable('Görselin boyutları okunamadı.', 'Görsel boyutu okunamadı.');
    }

    if (width < MIN_ICON_DIMENSION || height < MIN_ICON_DIMENSION) {
      throw this.unprocessable(
        `İkon en az ${MIN_ICON_DIMENSION}×${MIN_ICON_DIMENSION} piksel olmalıdır. Gönderilen: ${width}×${height}.`,
        'Görsel ikon için çok küçük.',
      );
    }

    if (width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION) {
      throw this.unprocessable(
        `İkon en fazla ${MAX_ICON_DIMENSION}×${MAX_ICON_DIMENSION} piksel olabilir. Gönderilen: ${width}×${height}.`,
        'Görsel ikon için çok büyük.',
      );
    }

    const ratio = Math.max(width, height) / Math.min(width, height);

    if (ratio > MAX_ICON_ASPECT_RATIO) {
      throw this.unprocessable(
        `İkon kareye yakın olmalıdır (en/boy oranı en çok ${MAX_ICON_ASPECT_RATIO}). Gönderilen: ${width}×${height}.`,
        'Görsel çok dikdörtgen; kare bir ikon yükleyin.',
      );
    }

    try {
      return await image
        .rotate()
        .resize(ICON_OUTPUT_SIZE, ICON_OUTPUT_SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: ICON_OUTPUT_QUALITY })
        .toBuffer();
    } catch {
      throw this.unprocessable('Görsel işlenemedi.', 'Görsel işlenemedi.');
    }
  }

  private unprocessable(message: string, fieldMessage: string): AppException {
    return new AppException(ERROR_CODES.UNPROCESSABLE, message, 422, [
      { field: 'file', message: fieldMessage },
    ]);
  }
}
