import { Prisma } from '@prisma/client';

/**
 * Prisma `select` tanımları.
 *
 * KURAL 8: public seçici AÇIK tutulur. Talep kaydında `internalNote`,
 * `ipAddress` ve `userAgent` gibi alanlar var; bunlar müşteriye
 * DÖNMEZ. `include` kullanılsaydı ileride eklenecek bir alan sessizce
 * dışarı sızardı.
 */

/**
 * Talep gönderildikten sonra müşteriye dönen yanıt.
 *
 * Yalnız numara ve teyit bilgisi: müşteri kendi gönderdiği kalemleri
 * zaten biliyor, sunucunun onları geri göndermesi gereksiz veri akışı
 * ve gereksiz sızma yüzeyi olurdu.
 */
export const PUBLIC_INQUIRY_RESULT_SELECT = {
  id: true,
  inquiryNumber: true,
  status: true,
  createdAt: true,
  estimatedTotal: true,
  contactName: true,
  preferredContact: true,
  _count: { select: { items: true } },
} as const satisfies Prisma.InquirySelect;

/** Yönetim listesi. */
export const ADMIN_INQUIRY_LIST_SELECT = {
  id: true,
  inquiryNumber: true,
  status: true,
  source: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  city: true,
  district: true,
  preferredContact: true,
  estimatedTotal: true,
  currency: true,
  contactedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: { select: { id: true, fullName: true } },
  /**
   * Eşleştirilmiş müşteri (Sprint 7 şartı 4).
   *
   * Talep public taraftan müşteri kaydı olmadan da gelebilir; bu yüzden
   * nullable. Dolu olduğunda listede rozet, detayda bağlantı gösterilir.
   */
  customer: { select: { id: true, code: true, fullName: true, phone: true } },
  /**
   * Talebi GÖNDEREN public hesap (Sprint 11).
   *
   * `customer` ile karıştırılmamalıdır: o mağazanın CRM kartıdır, bu ise
   * ziyaretçinin kendi açtığı giriş hesabıdır. Talep misafir olarak
   * geldiyse null olur.
   *
   * `emailVerifiedAt` LİSTEDE DE GÖSTERİLİR: yönetici, doğrulanmamış bir
   * hesaptan gelen talebi ayırt edebilmelidir — o adresin gerçekten
   * gönderene ait olduğu kanıtlanmamıştır.
   */
  customerAccount: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      emailVerifiedAt: true,
      customerId: true,
    },
  },
  _count: { select: { items: true } },
} as const satisfies Prisma.InquirySelect;

/** Yönetim detayı — kalemler ve durum geçmişiyle. */
export const ADMIN_INQUIRY_DETAIL_SELECT = {
  ...ADMIN_INQUIRY_LIST_SELECT,
  address: true,
  customerNote: true,
  internalNote: true,
  consentAccepted: true,
  consentAt: true,
  ipAddress: true,
  userAgent: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      variantId: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      unitTypeSnapshot: true,
      unitQuantitySnapshot: true,
      displayedPriceSnapshot: true,
      quantity: true,
      lineTotal: true,
      note: true,
      // Ürün silinmiş olabilir; snapshot alanları zaten yeterli, bu
      // yalnız yöneticinin ürüne gidebilmesi için.
      product: { select: { slug: true, isActive: true, isPublished: true, deletedAt: true } },
      variant: { select: { isActive: true, stockQuantity: true, deletedAt: true } },
    },
  },
  statusHistories: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true } },
    },
  },
} as const satisfies Prisma.InquirySelect;
