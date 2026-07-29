import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import type { StorageDriver, StorageFile, StoredFile } from './storage.interface';

/** Yüklenen dosyaların kök dizini. Docker'da volume olarak bağlanır. */
const UPLOAD_ROOT = 'uploads';

/** Public erişim ön eki. Nginx/Next bu yolu statik olarak sunar. */
const PUBLIC_PREFIX = '/uploads';

/** MIME tipinden dosya uzantısı. */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Yerel disk depolama sürücüsü.
 *
 * MVP içindir. Üretimde S3/R2 sürücüsüyle değiştirilecektir —
 * `StorageDriver` arayüzü sayesinde uygulama kodunda değişiklik gerekmez.
 *
 * Dosya adı YENİDEN ÜRETİLİR: kullanıcının verdiği ad hiçbir zaman dosya
 * sisteminde kullanılmaz. Bu, dizin geçişi (`../../etc/passwd`) ve
 * çalıştırılabilir uzantı (`.php`) saldırılarını baştan kapatır.
 */
@Injectable()
export class LocalDiskStorage implements StorageDriver {
  private readonly logger = new Logger(LocalDiskStorage.name);

  async save(file: StorageFile, folder: string): Promise<StoredFile> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    // Tarihe göre alt klasör: tek dizinde on binlerce dosya birikmesin.
    const relativeFolder = join(sanitizeFolder(folder), String(year), month);
    const extension = EXTENSION_BY_MIME[file.mimeType] ?? extname(file.originalName) ?? '.bin';
    const fileName = `${randomUUID()}${extension}`;

    const storageKey = join(relativeFolder, fileName);
    const absoluteFolder = join(process.cwd(), UPLOAD_ROOT, relativeFolder);

    await mkdir(absoluteFolder, { recursive: true });
    await writeFile(join(absoluteFolder, fileName), file.buffer);

    this.logger.debug(`Dosya kaydedildi: ${storageKey} (${file.size} bayt)`);

    return {
      storageKey,
      url: this.getUrl(storageKey),
      mimeType: file.mimeType,
      sizeBytes: file.size,
    };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(join(process.cwd(), UPLOAD_ROOT, storageKey));
    } catch (error) {
      // Dosya zaten yoksa sorun değil: silme işlemi idempotent olmalıdır.
      // Kayıt silinip dosya kalmasındansa tersi tercih edilir.
      this.logger.warn(
        `Dosya silinemedi (yok sayıldı): ${storageKey} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  getUrl(storageKey: string): string {
    // Windows'ta join ters eğik çizgi üretir; URL her zaman düz çizgidir.
    return `${PUBLIC_PREFIX}/${storageKey.split(/[\\/]/).join('/')}`;
  }
}

/**
 * Klasör adını güvenli hâle getirir.
 * Dizin geçişini (`..`) ve mutlak yolu engeller.
 */
function sanitizeFolder(folder: string): string {
  return folder.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'misc';
}

/** İçerik özeti — aynı dosyanın tekrar yüklenmesini tespit etmek için. */
export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
