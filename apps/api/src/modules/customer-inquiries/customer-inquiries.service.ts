import { Injectable } from '@nestjs/common';
import {
  buildPaginationMeta,
  toSkipTake,
  type CustomerInquiryDetail,
  type CustomerInquiryListItem,
  type InquiryStatus,
  type PaginatedResult,
  type PreferredContact,
} from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trimQuantity } from '../../common/utils/quantity-rules';
import { PrismaService } from '../../infra/prisma/prisma.service';

import {
  CUSTOMER_INQUIRY_DETAIL_SELECT,
  CUSTOMER_INQUIRY_LIST_SELECT,
  type CustomerInquiryDetailRow,
  type CustomerInquiryListRow,
} from './customer-inquiries.select';

/**
 * "Taleplerim" — müşterinin kendi talepleri (Sprint 11 şartı 3).
 *
 * YETKİLENDİRME DESENİ: sahiplik koşulu HER SORGUNUN `where`İNDEDİR, kayıt
 * çekildikten sonra kontrol edilmez.
 *
 *   Yanlış:  const inquiry = await find(number); if (inquiry.accountId !== me) throw
 *   Doğru:   await findFirst({ where: { number, customerAccountId: me } })
 *
 * İki nedenle: (1) kontrolü yazmayı unutmak mümkün değil, (2) yanlış sahip
 * için sorgu BOŞ döner ve doğal olarak 404 üretir — kaydın var olduğu bilgisi
 * hiç oluşmaz.
 */
@Injectable()
export class CustomerInquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Hesabın talepleri — en yeni önce. */
  async findMany(
    accountId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CustomerInquiryListItem>> {
    const where = { customerAccountId: accountId, deletedAt: null };
    const { skip, take } = toSkipTake(query.page, query.limit);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inquiry.findMany({
        where,
        skip,
        take,
        // Sıralama SABİTTİR (en yeni önce) ve istemciden alınmaz: müşterinin
        // talep geçmişinde tek anlamlı sıra budur, `sortBy` açmak sonuç
        // vermeyen bir yüzey genişletmesi olurdu.
        orderBy: { createdAt: 'desc' },
        select: CUSTOMER_INQUIRY_LIST_SELECT,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    return {
      items: rows.map(toListItem),
      meta: buildPaginationMeta(total, query.page, query.limit),
    };
  }

  /**
   * Tek talep — YALNIZ KENDİ TALEBİ.
   *
   * BAŞKASININ TALEP NUMARASI 404 DÖNER, 403 DEĞİL. 403 "bu numara var ama
   * senin değil" demektir; talep numaraları sıralı üretildiği için
   * (TLP-2026-000001, -000002...) bir saldırgan sayarak mağazanın kaç talep
   * aldığını ve hangi numaraların dolu olduğunu öğrenebilirdi. 404, var
   * olmayan numarayla aynı yanıtı verir ve hiçbir şey söylemez.
   */
  async findOne(accountId: string, inquiryNumber: string): Promise<CustomerInquiryDetail> {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { inquiryNumber, customerAccountId: accountId, deletedAt: null },
      select: CUSTOMER_INQUIRY_DETAIL_SELECT,
    });

    if (inquiry === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    return toDetail(inquiry);
  }
}

function toListItem(row: CustomerInquiryListRow): CustomerInquiryListItem {
  return {
    inquiryNumber: row.inquiryNumber,
    status: row.status as InquiryStatus,
    createdAt: row.createdAt.toISOString(),
    itemCount: row._count.items,
    estimatedTotal: row.estimatedTotal.toString(),
    currency: row.currency,
  };
}

function toDetail(row: CustomerInquiryDetailRow): CustomerInquiryDetail {
  return {
    inquiryNumber: row.inquiryNumber,
    status: row.status as InquiryStatus,
    createdAt: row.createdAt.toISOString(),
    contactedAt: row.contactedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    city: row.city,
    district: row.district,
    address: row.address,
    preferredContact: row.preferredContact as PreferredContact,
    customerNote: row.customerNote,
    estimatedTotal: row.estimatedTotal.toString(),
    currency: row.currency,
    items: row.items.map((item) => ({
      productName: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      sku: item.skuSnapshot,
      unitTypeName: item.unitTypeSnapshot,
      quantity: trimQuantity(item.quantity),
      displayedPrice: item.displayedPriceSnapshot?.toString() ?? null,
      lineTotal: item.lineTotal?.toString() ?? null,
      note: item.note,
      productSlug: isProductVisible(item.product) ? item.product.slug : null,
    })),
  };
}

/** Ürün hâlâ vitrinde mi? Değilse bağlantı verilmez (404'e götürürdü). */
function isProductVisible(
  product: { slug: string; isActive: boolean; isPublished: boolean; deletedAt: Date | null } | null,
): product is { slug: string; isActive: boolean; isPublished: boolean; deletedAt: null } {
  return product !== null && product.deletedAt === null && product.isActive && product.isPublished;
}
