/**
 * Telefon numarası normalleştirmesi — TÜM modüllerin ortak kaynağı.
 *
 * Sprint 6'da `InquiriesService` içinde doğmuştu; Sprint 7 (müşteri kartı) ve
 * Sprint 11 (müşteri hesabı) de aynı biçimi kullandığı için buraya taşındı.
 * Modüller arası dosya içe aktarımıyla paylaşılması, `customer-auth` ile
 * `inquiries` arasında gerçek olmayan bir bağımlılık kurardı.
 *
 * Kullanıcı "0532 123 45 67", "+90 532 123 45 67" veya "5321234567" yazabilir;
 * hepsi aynı numaradır. Kayda 10 haneli biçim yazılır (5321234567) ki "aynı
 * numaradan gelen talepler" ve "mükerrer müşteri" sorguları çalışsın.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.startsWith('90') && digits.length === 12) {
    return digits.slice(2);
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return digits.slice(1);
  }

  return digits;
}
