import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Numara üretilen kayıt türleri (Kural 12: sihirli string yok). */
export const NUMBER_SCOPES = {
  INQUIRY: 'INQUIRY',
  SALE: 'SALE',
  PAYMENT: 'PAYMENT',
  CUSTOMER: 'CUSTOMER',
} as const;

export type NumberScope = (typeof NUMBER_SCOPES)[keyof typeof NUMBER_SCOPES];

/** Sıra numarasının en az kaç basamak olacağı: TLP-2026-000001. */
const SEQUENCE_PADDING = 6;

/**
 * Yıl bazlı, çakışmasız belge numarası üreteci.
 *
 * NEDEN SAYAÇ TABLOSU:
 * `MAX(inquiryNumber) + 1` yaklaşımı iki eşzamanlı istekte AYNI numarayı
 * üretir; unique kısıtı ikinci isteği 500'e düşürürdü. Burada sayaç satırı
 * `SELECT ... FOR UPDATE` ile kilitlenir — ikinci istek kilidi bekler,
 * sırayla ilerlerler ve iki farklı numara alırlar.
 *
 * KİLİT SÜRESİ: kilit, çağıran transaction commit edene kadar tutulur.
 * Bu yüzden numara üretimi transaction'ın MÜMKÜN OLDUĞUNCA SONUNDA
 * çağrılmalıdır; başında çağrılırsa tüm talep oluşturma süresi boyunca
 * diğer talepler bekler.
 */
@Injectable()
export class NumberSequenceService {
  /**
   * Sıradaki numarayı üretir.
   *
   * @param tx Çağıran transaction — kilit onun ömrüne bağlıdır. Ayrı bir
   *   bağlantıda çalıştırılırsa kilit erken bırakılır ve garanti kaybolur.
   * @param prefix Belge ön eki, ör. `TLP`.
   * @param date Numaranın yıl bileşeni. Yıl dönümünde hangi yıla ait
   *   olacağı çağıranın kararıdır; varsayılan "şimdi".
   */
  async next(
    tx: Prisma.TransactionClient,
    scope: NumberScope,
    prefix: string,
    date: Date = new Date(),
  ): Promise<string> {
    const year = date.getUTCFullYear();

    // Tek deyimde upsert + artırma + kilit.
    //
    // `ON CONFLICT DO UPDATE` çakışan satırı kilitler; ayrı bir SELECT
    // FOR UPDATE'e gerek kalmaz ve ilk kayıt ile sonrakiler aynı yoldan
    // geçer (yılın ilk talebinde yarış oluşmaz).
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "number_sequences" ("id", "scope", "year", "lastValue", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${scope}, ${year}, 1, NOW(), NOW())
      ON CONFLICT ("scope", "year")
      DO UPDATE SET "lastValue" = "number_sequences"."lastValue" + 1, "updatedAt" = NOW()
      RETURNING "lastValue"
    `;

    const value = rows[0]?.lastValue;

    if (value === undefined) {
      throw new Error(`Numara üretilemedi: ${scope}/${year}`);
    }

    return format(prefix, year, value);
  }
}

/** `TLP-2026-000001` biçimini kurar. */
export function format(prefix: string, year: number, value: number): string {
  return `${prefix.toUpperCase()}-${year}-${String(value).padStart(SEQUENCE_PADDING, '0')}`;
}
