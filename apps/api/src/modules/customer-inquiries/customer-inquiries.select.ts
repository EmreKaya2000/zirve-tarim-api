import { Prisma } from '@prisma/client';

/**
 * MÜŞTERİ GÖRÜNÜMÜ seçicileri — Kural 8.
 *
 * Yönetim seçicilerinden (`inquiries.select.ts`) alan çıkararak DEĞİL, sıfırdan
 * yazılarak üretildi. `ADMIN_INQUIRY_DETAIL_SELECT`ten türetilseydi, şemaya
 * ileride eklenecek herhangi bir yönetici alanı buraya da sızardı.
 *
 * BU YANITTA BİLİNÇLİ OLARAK BULUNMAYANLAR:
 *   internalNote  — yalnız mağaza personeli görür
 *   ipAddress     — talebi gönderenin IP'si
 *   userAgent     — tarayıcı parmak izi
 *   assignedTo    — talebi hangi personelin takip ettiği
 *   customer      — CRM kartı, kodu ve finansal bağları
 *   purchasePrice — hiçbir yoldan erişilemez (kalem seçicisinde yok)
 */

/** "Taleplerim" listesi. */
export const CUSTOMER_INQUIRY_LIST_SELECT = {
  inquiryNumber: true,
  status: true,
  createdAt: true,
  estimatedTotal: true,
  currency: true,
  _count: { select: { items: true } },
} as const satisfies Prisma.InquirySelect;

export type CustomerInquiryListRow = Prisma.InquiryGetPayload<{
  select: typeof CUSTOMER_INQUIRY_LIST_SELECT;
}>;

/** Talep detayı — müşterinin kendi gönderdiği bilgiler ve durum. */
export const CUSTOMER_INQUIRY_DETAIL_SELECT = {
  inquiryNumber: true,
  status: true,
  createdAt: true,
  contactedAt: true,
  closedAt: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  city: true,
  district: true,
  address: true,
  preferredContact: true,
  customerNote: true,
  estimatedTotal: true,
  currency: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      unitTypeSnapshot: true,
      quantity: true,
      displayedPriceSnapshot: true,
      lineTotal: true,
      note: true,
      /**
       * Ürün bağlantısı YALNIZ hâlâ yayındaysa gösterilir.
       *
       * Yayından kalkmış bir ürünün adresini vermek müşteriyi 404 sayfasına
       * götürür; snapshot alanları zaten ne talep ettiğini anlatıyor.
       */
      product: { select: { slug: true, isActive: true, isPublished: true, deletedAt: true } },
    },
  },
} as const satisfies Prisma.InquirySelect;

export type CustomerInquiryDetailRow = Prisma.InquiryGetPayload<{
  select: typeof CUSTOMER_INQUIRY_DETAIL_SELECT;
}>;
