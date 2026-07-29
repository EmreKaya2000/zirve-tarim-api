import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { buildPaginationMeta, ERROR_CODES, toSkipTake, type PaginatedResult } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { normalizePhone } from '../../common/utils/phone';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import type { CustomerAccountQueryDto } from './dto/customer-account-admin.dto';

const ENTITY_TYPE = 'CustomerAccount';

/**
 * YÖNETİM görünümü seçicisi.
 *
 * `passwordHash`, `failedLoginCount`, `lockedUntil` ve `consentIpAddress`
 * BURADA DA YOKTUR: yönetici müşterinin şifresini yönetmez ve kilit sayacını
 * görmesi bir işe yaramaz. Hesap kurtarma, kullanıcının kendi "şifremi
 * unuttum" akışıyla yapılır — yöneticinin şifre sıfırlayabilmesi, sosyal
 * mühendislikle hesap devralmanın en kolay yolu olurdu.
 */
const ADMIN_ACCOUNT_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  emailVerifiedAt: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  customer: { select: { id: true, code: true, fullName: true, phone: true } },
  _count: { select: { inquiries: true } },
} as const satisfies Prisma.CustomerAccountSelect;

/**
 * Müşteri hesaplarının YÖNETİM tarafı — Sprint 11 şartı 5.
 *
 * Yöneticinin buradaki tek yetkisi HESAP ↔ CRM KARTI BAĞINI kurmak ve
 * kaldırmaktır. Şifre sıfırlama, hesap oluşturma ve e-posta değiştirme
 * BİLİNÇLİ OLARAK YOKTUR: bunlar hesabın sahibine ait işlemlerdir ve
 * yöneticiye açılması, telefonla arayan birinin ikna kabiliyetini hesap
 * devralma yetkisine çevirirdi.
 */
@Injectable()
export class CustomerAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany(query: CustomerAccountQueryDto): Promise<PaginatedResult<unknown>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerAccount.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_ACCOUNT_SELECT,
      }),
      this.prisma.customerAccount.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async findOne(id: string): Promise<unknown> {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id, deletedAt: null },
      select: ADMIN_ACCOUNT_SELECT,
    });

    if (account === null) {
      throw AppException.notFound('Müşteri hesabı bulunamadı.');
    }

    return account;
  }

  /**
   * Hesabı bir CRM müşteri kartına bağlar veya bağı kaldırır.
   *
   * NEDEN ELLE YAPILIYOR (otomatik değil): eşleştirmenin doğru olduğunu
   * yalnız mağaza bilir. Telefon veya ad benzerliğiyle otomatik bağlamak,
   * aynı hattı paylaşan baba-oğulun hesaplarını ve borçlarını birbirine
   * karıştırırdı. E-posta ise CRM kartlarında çoğu zaman boştur (kartları
   * tezgahta yönetici açar).
   *
   * KARDİNALİTE 1↔1: hem hesap hem kart en fazla bir kez bağlanabilir.
   * Çakışma veritabanı UNIQUE kısıtıyla da güvence altındadır; buradaki
   * kontrol yöneticiye ANLAŞILIR bir hata vermek içindir.
   */
  async link(id: string, customerId: string | null, actor: ActorContext): Promise<unknown> {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, customerId: true },
    });

    if (account === null) {
      throw AppException.notFound('Müşteri hesabı bulunamadı.');
    }

    if (customerId !== null) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: {
          id: true,
          code: true,
          fullName: true,
          isActive: true,
          account: { select: { id: true } },
        },
      });

      if (customer === null) {
        throw AppException.notFound('Müşteri bulunamadı.', [
          { field: 'customerId', message: 'Seçilen müşteri bulunamadı veya silinmiş.' },
        ]);
      }

      if (!customer.isActive) {
        throw AppException.badRequest('Pasif müşteri hesaba bağlanamaz.', [
          { field: 'customerId', message: `${customer.fullName} pasif durumda.` },
        ]);
      }

      if (customer.account !== null && customer.account.id !== id) {
        throw new AppException(
          ERROR_CODES.ACCOUNT_LINK_CONFLICT,
          `${customer.fullName} (${customer.code}) zaten başka bir hesaba bağlı.`,
          HttpStatus.CONFLICT,
          [
            {
              field: 'customerId',
              message:
                'Bir müşteri kartı en fazla bir hesaba bağlanabilir. Önce mevcut bağı kaldırın.',
            },
          ],
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerAccount.update({ where: { id }, data: { customerId } });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.ACCOUNT_LINKED,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { customerId: account.customerId },
        newData: { customerId },
        description:
          customerId === null
            ? `Müşteri hesabının kart bağı kaldırıldı: ${account.email}`
            : `Müşteri hesabı bir müşteri kartına bağlandı: ${account.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(id);
  }

  /**
   * Bir CRM kartıyla EŞLEŞEBİLECEK hesap adaylarını önerir.
   *
   * YALNIZ ÖNERİDİR, otomatik bağlama YAPMAZ (Sprint 11 şartı 3'ün açık
   * kararı): telefon numarası bu sistemde doğrulanmıyor. Yönetici listeyi
   * görür, tanıdığı kişiyi seçer ve bağı kendisi kurar.
   *
   * Zaten bağlı hesaplar aday listesine girmez.
   */
  async suggestForCustomer(customerId: string): Promise<unknown[]> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, phone: true, email: true },
    });

    if (customer === null) {
      throw AppException.notFound('Müşteri bulunamadı.');
    }

    const matchers: Prisma.CustomerAccountWhereInput[] = [
      { phone: normalizePhone(customer.phone) },
    ];

    if (customer.email !== null && customer.email.trim() !== '') {
      matchers.push({ email: customer.email.trim().toLocaleLowerCase('en-US') });
    }

    return this.prisma.customerAccount.findMany({
      where: { deletedAt: null, customerId: null, OR: matchers },
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: ADMIN_ACCOUNT_SELECT,
    });
  }
}

function buildWhere(query: CustomerAccountQueryDto): Prisma.CustomerAccountWhereInput {
  const conditions: Prisma.CustomerAccountWhereInput[] = [{ deletedAt: null }];

  if (query.linked === 'true') {
    conditions.push({ customerId: { not: null } });
  }

  if (query.linked === 'false') {
    conditions.push({ customerId: null });
  }

  const term = query.search?.trim();

  if (term !== undefined && term !== '') {
    conditions.push({
      OR: [
        { email: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        // Telefon normalleştirilmiş saklanır; arama terimi de aynı biçime
        // çevrilmezse "0532 123..." yazan yönetici hiçbir sonuç görmezdi.
        { phone: { contains: normalizePhone(term) } },
      ],
    });
  }

  return { AND: conditions };
}
