import { createHash, randomBytes } from 'node:crypto';

/**
 * Opak jetonların üretimi ve özetlenmesi.
 *
 * ÜÇ YERDE AYNI KURAL GEÇERLİ: yenileme jetonu, e-posta doğrulama jetonu ve
 * şifre sıfırlama jetonu. Hepsi ham hâlde YALNIZ istemciye/postaya gider;
 * veritabanına özeti yazılır. Bu dosya o sözleşmenin tek kaynağıdır — üç
 * modülde ayrı ayrı yazılsaydı birinde `sha256`, diğerinde ham saklama gibi
 * bir sapma fark edilmeden yaşayabilirdi.
 *
 * NEDEN SHA-256, NEDEN ARGON2 DEĞİL: bu jetonlar 256 bit kriptografik
 * rastgelelik taşır, sözlük saldırısına açık bir "şifre" değildir. Argon2'nin
 * kasıtlı yavaşlığı burada yalnız maliyet olurdu.
 */

/** Üretilen jetonun ham bayt uzunluğu (256 bit). */
const TOKEN_BYTES = 32;

/** Kriptografik olarak güçlü, URL'de güvenli ham jeton üretir. */
export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Ham jetonun veritabanında aranacak SHA-256 özetini (hex) döndürür. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
