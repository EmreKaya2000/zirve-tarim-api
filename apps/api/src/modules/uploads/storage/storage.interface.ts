/**
 * Dosya depolama soyutlaması.
 *
 * NEDEN ARAYÜZ: MVP yerel diske yazar (docs/ARCHITECTURE.md V-37) ama üretimde
 * S3/R2/MinIO'ya geçilecektir. Uygulama kodu hiçbir yerde `fs` çağırmaz;
 * yalnız bu arayüzü kullanır. Sürücü değişimi tek bir sağlayıcı satırıdır.
 *
 * `storageKey` ile `url` AYRI tutulur: anahtar sürücüye göreli kalıcı
 * kimliktir, URL sürücüye göre değişebilir (yerel yol vs. CDN adresi).
 * Kayıtlarda ikisi de saklanır ki sürücü değişince URL yeniden üretilebilsin.
 */

/** Yüklenecek dosya. */
export interface StorageFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

/** Yükleme sonucu. */
export interface StoredFile {
  /** Sürücüye göreli kalıcı anahtar. Örn. "products/2026/07/abc123.webp" */
  storageKey: string;
  /** Erişim adresi. Yerel sürücüde "/uploads/...", S3'te tam URL. */
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

/** Depolama sürücüsü sözleşmesi. */
export interface StorageDriver {
  /**
   * Dosyayı kaydeder.
   * @param folder Mantıksal klasör. Örn. "products"
   */
  save(file: StorageFile, folder: string): Promise<StoredFile>;

  /** Dosyayı siler. Dosya yoksa hata FIRLATMAZ (idempotent). */
  delete(storageKey: string): Promise<void>;

  /** Anahtardan erişim adresi üretir. */
  getUrl(storageKey: string): string;
}

/** DI belirteci. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
