import { ERROR_CODES } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';

/**
 * Görsel yükleme doğrulaması — ÜRÜN GÖRSELİ VE KATEGORİ İKONU ORTAK KULLANIR.
 *
 * NEDEN AYRI DOSYA: kural iki yerde gerekiyor (galeri yüklemesi ve ikon
 * yüklemesi) ve ikisinin boyut sınırı farklı. Kopyalanmış bir doğrulama, bir
 * gün birinde düzeltilip diğerinde unutulur — magic byte kontrolü gibi bir
 * güvenlik katmanında bu sessiz bir delik demektir.
 */

/**
 * Kabul edilen tipler.
 *
 * SVG YOK ve bu bilinçli: SVG bir XML belgesidir, `<script>` ve dış varlık
 * referansı taşıyabilir; kendi alan adımızdan servis edildiğinde saklanmış
 * XSS'e dönüşür. Ayrıca magic byte'ı olmadığı için aşağıdaki içerik imzası
 * kontrolü ona uygulanamaz.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

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

/**
 * Üç katmanlı doğrulama: boyut, bildirilen MIME tipi ve GERÇEK içerik imzası.
 *
 * @param maxBytes Çağıranın sınırı. Ürün görseli ile kategori ikonu farklı
 *   sınırlar kullanır; sabit tek bir değer buraya gömülemez.
 */
export function assertValidImageFile(file: UploadedFileLike, maxBytes: number): void {
  if (file.size > maxBytes) {
    throw new AppException(
      ERROR_CODES.UNPROCESSABLE,
      `Dosya çok büyük: ${file.originalname}. En fazla ${formatMegabytes(maxBytes)}.`,
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

/** 1048576 -> "1 MB", 5242880 -> "5 MB" */
function formatMegabytes(bytes: number): string {
  return `${bytes / 1024 / 1024} MB`;
}
