/**
 * Slug üretimi.
 *
 * TÜRKÇE KARAKTER DÖNÜŞÜMÜ KRİTİKTİR: `String.normalize('NFD')` ile aksan
 * ayıklama Türkçe'de YANLIŞ sonuç verir — "ı" harfi "i"nin aksanlı biçimi
 * değildir, ayrı bir harftir ve NFD onu ayrıştırmaz. "ş" ve "ğ" için de
 * durum aynıdır. Bu yüzden açık bir eşleme tablosu kullanılır.
 */

/** Türkçe karakter → ASCII karşılığı. */
const TURKISH_MAP: Readonly<Record<string, string>> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  i: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
  â: 'a',
  Â: 'a',
  î: 'i',
  Î: 'i',
  û: 'u',
  Û: 'u',
};

/** Slug'ın azami uzunluğu. Sonek eklenirken bu sınır korunur. */
export const SLUG_MAX_LENGTH = 150;

/**
 * Metinden URL-güvenli slug üretir.
 *
 * @example
 * slugify('Sıvı Gübre')        // 'sivi-gubre'
 * slugify('Çiçeklenme Öncesi') // 'ciceklenme-oncesi'
 * slugify('NPK 20-20-20')      // 'npk-20-20-20'
 */
export function slugify(input: string, maxLength: number = SLUG_MAX_LENGTH): string {
  const transliterated = Array.from(input)
    .map((char) => TURKISH_MAP[char] ?? char)
    .join('');

  const slug = transliterated
    .toLowerCase()
    // Kalan aksanlı Latin karakterleri (é, ñ...) için güvenli: Türkçe
    // harfler yukarıda zaten dönüştürüldü.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Harf, rakam ve boşluk dışındaki her şey ayraca dönüşür.
    .replace(/[^a-z0-9]+/g, '-')
    // Baş ve sondaki ayraçlar atılır.
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Çakışan bir slug'a sayısal sonek ekler: `sivi-gubre` → `sivi-gubre-2`.
 *
 * Azami uzunluk aşılacaksa taban kısaltılır; sonek her zaman korunur.
 */
export function appendSlugSuffix(
  baseSlug: string,
  suffix: number,
  maxLength: number = SLUG_MAX_LENGTH,
): string {
  const suffixPart = `-${suffix}`;
  const available = maxLength - suffixPart.length;
  const trimmedBase = baseSlug.slice(0, Math.max(1, available)).replace(/-+$/g, '');

  return `${trimmedBase}${suffixPart}`;
}
