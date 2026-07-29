import { Prisma } from '@prisma/client';

/**
 * Prisma `select` tanımları.
 *
 * KURAL 8 — BU DOSYADAKİ ALANLARIN TAMAMI YÖNETİM İÇİNDİR.
 *
 * Satış, maliyet ve kâr verisi PUBLIC BİR UÇTAN HİÇ DÖNMEZ: `sales`,
 * `payments` ve `customers` için public uç YOKTUR. Bu yüzden burada
 * public/admin ayrımı değil, tek bir yönetim seçicisi var.
 *
 * Yeni bir public uç eklenirse (ör. müşterinin kendi borcunu görmesi),
 * o uç için AYRI ve KISITLI bir seçici yazılmalıdır — bu dosyadakiler
 * `unitPurchasePrice`, `lineCost`, `lineProfit`, `costTotal`,
 * `grossProfit` ve `netProfit` içerir.
 */

export const ADMIN_SALE_LIST_SELECT = {
  id: true,
  saleNumber: true,
  status: true,
  paymentType: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  grandTotal: true,
  paidTotal: true,
  remainingTotal: true,
  grossProfit: true,
  netProfit: true,
  saleDate: true,
  dueDate: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  customer: { select: { id: true, code: true, fullName: true, phone: true } },
  createdBy: { select: { id: true, fullName: true } },
  inquiry: { select: { id: true, inquiryNumber: true } },
  _count: { select: { items: true, payments: true } },
} as const satisfies Prisma.SaleSelect;

export const ADMIN_SALE_DETAIL_SELECT = {
  ...ADMIN_SALE_LIST_SELECT,
  taxTotal: true,
  costTotal: true,
  additionalCostTotal: true,
  note: true,
  cancelReason: true,
  updatedAt: true,
  cancelledBy: { select: { id: true, fullName: true } },
  customer: {
    select: {
      id: true,
      code: true,
      fullName: true,
      companyName: true,
      phone: true,
      email: true,
      city: true,
      district: true,
      creditLimit: true,
    },
  },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      productId: true,
      variantId: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      unitTypeSnapshot: true,
      quantity: true,
      unitPurchasePrice: true,
      unitSalePrice: true,
      discountAmount: true,
      lineSubtotal: true,
      lineTotal: true,
      lineCost: true,
      lineProfit: true,
      sortOrder: true,
      product: { select: { slug: true, deletedAt: true } },
    },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { paymentDate: 'asc' },
    select: {
      id: true,
      paymentNumber: true,
      method: true,
      amount: true,
      paymentDate: true,
      dueDate: true,
      reference: true,
      note: true,
      createdBy: { select: { id: true, fullName: true } },
    },
  },
  additionalCosts: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      costType: true,
      description: true,
      amount: true,
      createdAt: true,
      createdBy: { select: { id: true, fullName: true } },
    },
  },
} as const satisfies Prisma.SaleSelect;
