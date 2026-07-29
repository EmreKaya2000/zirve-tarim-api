import { Prisma } from '@prisma/client';

/**
 * MİKTAR KURALLARININ TEK BAĞLAYICI KAYNAĞI (Sprint 11'de buraya taşındı).
 *
 * NEDEN ORTAK BİR MODÜL:
 *
 * Aynı kurallar iki farklı POLİTİKAYLA uygulanıyor:
 *
 *   TALEP GÖNDERME (Sprint 6)  -> İHLALİ REDDEDER. Kullanıcı formu doldurmuş,
 *                                 ne istediğini biliyor; miktarını sessizce
 *                                 değiştirip mağazaya farklı bir sayı iletmek
 *                                 kabul edilemez.
 *   SEPET BİRLEŞTİRME (Sprint 11) -> EN YAKIN GEÇERLİ MİKTARA AYARLAR. Misafir
 *                                 sepetiyle sunucu sepeti TOPLANDIĞINDA sonuç
 *                                 adım ızgarasına düşmeyebilir (2 + 3 = 5 ama
 *                                 adım 2'yse geçersiz). Burada reddetmek,
 *                                 kullanıcının sepetini KAYBETTİRİRDİ — oysa
 *                                 sprintin amacı tam tersi.
 *
 * İki politika ayrı, KURAL AYNI. Kural iki yerde yazılsaydı biri değişip
 * diğeri kalabilirdi: sepette geçerli görünen bir miktar talep gönderiminde
 * reddedilir ve kullanıcı çıkmaz bir döngüye girerdi.
 *
 * ONDALIK KIYASLAMA `Prisma.Decimal` İLEDİR, JS float ile DEĞİL:
 * `(2.5 - 0.5) % 0.5` float'ta 0 yerine 0.49999...'a düşer ve geçerli bir
 * miktar reddedilirdi.
 */

/** Miktarın uyması gereken kurallar — varyasyondan okunur. */
export interface QuantityRuleSet {
  minOrderQuantity: Prisma.Decimal.Value;
  quantityStep: Prisma.Decimal.Value;
  maxOrderQuantity: Prisma.Decimal.Value | null;
  /** Birim ondalık miktar kabul ediyor mu? "2.5 kg" geçerli, "2.5 adet" değil. */
  allowsDecimal: boolean;
}

/** Miktarın hangi kuralı ihlal ettiği. */
export type QuantityViolation =
  | { kind: 'not-positive' }
  | { kind: 'not-integer' }
  | { kind: 'below-min'; min: Prisma.Decimal }
  | { kind: 'above-max'; max: Prisma.Decimal }
  | { kind: 'off-step'; min: Prisma.Decimal; step: Prisma.Decimal };

/**
 * Miktarı doğrular. Geçerliyse `null` döner.
 *
 * SIRA ÖNEMLİDİR ve kullanıcıya en yararlı hatayı önce verir: "0.5 adet"
 * girildiğinde asıl sorun ondalık olmasıdır, asgari miktarın altında kalması
 * değil.
 */
export function checkQuantity(
  quantity: Prisma.Decimal,
  rules: QuantityRuleSet,
): QuantityViolation | null {
  if (quantity.lessThanOrEqualTo(0)) {
    return { kind: 'not-positive' };
  }

  if (!rules.allowsDecimal && !quantity.isInteger()) {
    return { kind: 'not-integer' };
  }

  const min = new Prisma.Decimal(rules.minOrderQuantity);

  if (quantity.lessThan(min)) {
    return { kind: 'below-min', min };
  }

  if (rules.maxOrderQuantity !== null) {
    const max = new Prisma.Decimal(rules.maxOrderQuantity);

    if (quantity.greaterThan(max)) {
      return { kind: 'above-max', max };
    }
  }

  const step = new Prisma.Decimal(rules.quantityStep);

  // Adım 0 veya negatifse ızgara yoktur: her miktar (aralık içinde) geçerlidir.
  if (step.greaterThan(0) && !quantity.minus(min).modulo(step).isZero()) {
    return { kind: 'off-step', min, step };
  }

  return null;
}

/**
 * Miktarı kurallara uyan EN YAKIN geçerli değere çeker.
 *
 * Yalnız sepet birleştirmede kullanılır (yukarıdaki politika ayrımına bakın).
 *
 * @returns Geçerli miktar; varyasyonun kuralları hiçbir geçerli miktar
 *          üretmiyorsa (ör. `min > max`, ya da adet biriminde ondalık adım
 *          tanımlanmış) `null`.
 */
export function resolveNearestValidQuantity(
  requested: Prisma.Decimal,
  rules: QuantityRuleSet,
): Prisma.Decimal | null {
  const min = new Prisma.Decimal(rules.minOrderQuantity);
  const step = new Prisma.Decimal(rules.quantityStep);
  const max = rules.maxOrderQuantity === null ? null : new Prisma.Decimal(rules.maxOrderQuantity);

  // Tutarsız yapılandırma: aralık boş. Miktar uydurmak yerine kalem atlanır ve
  // yöneticinin varyasyonu düzeltmesi beklenir.
  if (max !== null && min.greaterThan(max)) {
    return null;
  }

  // ASGARİYE ÇEKME İSTİSNASI: istenen miktar asgarinin altındaysa asgariye
  // YUKARI çekilir. "En yakın geçerli değer" burada bilinçli olarak aşağı
  // değil yukarı yuvarlar — 0 çıkarsa kalem sepetten düşerdi ve kullanıcı
  // ürünü kaybetmiş olurdu.
  let candidate = requested.lessThan(min) ? min : requested;

  if (step.greaterThan(0)) {
    // Izgara ASGARİYE ÇAPALIDIR: geçerli miktarlar min, min+step, min+2*step...
    // Sıfıra çapalanmış bir ızgara, min=3/step=5 gibi bir varyasyonda 5'i
    // geçerli sayardı — oysa 5, 3'ten adım katı uzaklıkta değildir.
    const steps = candidate
      .minus(min)
      .dividedBy(step)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

    candidate = min.plus(step.times(steps.lessThan(0) ? 0 : steps));
  }

  if (max !== null && candidate.greaterThan(max)) {
    candidate = step.greaterThan(0)
      ? // Üst sınırı AŞMAYAN en büyük ızgara noktasına in. Yukarı yuvarlama
        // max'ı aşan bir miktar üretir ve o miktar da geçersiz olurdu.
        min.plus(
          step.times(max.minus(min).dividedBy(step).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)),
        )
      : max;
  }

  // Miktar Decimal(18,3) olarak saklanır; fazlası veritabanında zaten
  // yuvarlanır. Burada yapmak, döndürülen değerin saklanacak değerle
  // AYNI olmasını garanti eder.
  candidate = candidate.toDecimalPlaces(QUANTITY_DECIMAL_PLACES);

  // Son söz doğrulayıcıya aittir: hesabın sonucu kuralları geçmiyorsa
  // (ör. adet biriminde ondalık adım) miktar uydurulmaz, kalem atlanır.
  return checkQuantity(candidate, rules) === null ? candidate : null;
}

/** Miktarın ondalık çözünürlüğü — `Decimal(18,3)` ile aynı. */
export const QUANTITY_DECIMAL_PLACES = 3;

/**
 * Kural ihlalini kullanıcıya gösterilecek Türkçe metne çevirir.
 *
 * Metinler Sprint 6'daki hâliyle KORUNMUŞTUR: e2e testleri ve arayüz bu
 * ifadelere ("En az", "adımlarla", "En fazla", "ondalık") dayanıyor. Talep
 * gönderme ve sepet uçları AYNI metni kullanır — kullanıcı aynı kuralı iki
 * farklı cümleyle okumamalı.
 */
export function quantityViolationMessage(violation: QuantityViolation, unitLabel: string): string {
  switch (violation.kind) {
    case 'not-positive':
      return 'Miktar sıfırdan büyük olmalıdır.';
    case 'not-integer':
      return `${unitLabel} biriminde ondalık miktar girilemez.`;
    case 'below-min':
      return `En az ${trimQuantity(violation.min)} ${unitLabel} talep edebilirsiniz.`;
    case 'above-max':
      return `En fazla ${trimQuantity(violation.max)} ${unitLabel} talep edebilirsiniz.`;
    case 'off-step':
      return (
        `Miktar ${trimQuantity(violation.min)} ${unitLabel} ve üzerine ` +
        `${trimQuantity(violation.step)} ${unitLabel} adımlarla artmalıdır.`
      );
  }
}

/**
 * Varyasyon satırından kural kümesini çıkarır.
 *
 * `unitType.allowsDecimal` iç içe geldiği için düzleştirilir: kural kümesi
 * Prisma şemasından bağımsız kalsın, böylece saf işlevler test edilirken
 * varyasyon nesnesi taklit edilmek zorunda olmasın.
 */
export function toQuantityRules(variant: {
  minOrderQuantity: Prisma.Decimal.Value;
  quantityStep: Prisma.Decimal.Value;
  maxOrderQuantity: Prisma.Decimal.Value | null;
  unitType: { allowsDecimal: boolean };
}): QuantityRuleSet {
  return {
    minOrderQuantity: variant.minOrderQuantity,
    quantityStep: variant.quantityStep,
    maxOrderQuantity: variant.maxOrderQuantity,
    allowsDecimal: variant.unitType.allowsDecimal,
  };
}

/** `5.000` -> `5`, `2.500` -> `2.5` — kullanıcıya gösterim için. */
export function trimQuantity(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toDecimalPlaces(QUANTITY_DECIMAL_PLACES).toString();
}

/** Sayısal metni Decimal'e çevirir; çevrilemiyorsa `null`. */
export function toQuantityDecimal(value: string): Prisma.Decimal | null {
  try {
    const parsed = new Prisma.Decimal(value);

    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}
