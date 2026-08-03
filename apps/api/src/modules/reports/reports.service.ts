import { Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import {
  AGING_BUCKETS,
  CHART_MONTHS,
  OPEN_DEBT_SALE_STATUSES,
  REPORTABLE_SALE_STATUSES,
  RETAIL_CUSTOMER_CODE,
  TOP_LIST_LIMIT,
  type AgingBucket,
} from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Rapor sorguları — ağır toplama işlerinin TEK YERİ (Sprint 10 şartı 7).
 *
 * NEDEN HAM SQL: buradaki sorgular çok satırlı gruplama, koşullu kova
 * dağıtımı (`CASE`) ve ay bazlı zaman serisi üretir. Prisma'nın `groupBy`
 * API'si bunları ifade edemez; bellekte yapılsaydı tüm satışları çekip
 * Node tarafında toplamak gerekirdi ve rapor, veri büyüdükçe çökerdi.
 *
 * HER SORGU TİPLİDİR: `$queryRaw<T[]>` dönüş tipi elle yazılır ve sayısal
 * alanlar `::text` ile çekilir — para float'a UĞRAMAZ (Kural 2).
 *
 * İPTAL VE TASLAK SATIŞLAR HARİÇTİR (şart 7): durum filtresi tek bir
 * sabitten (`REPORTABLE_SALE_STATUSES`) gelir; hiçbir sorgu kendi listesini
 * yazmaz, yoksa bir rapor iptalleri sayarken diğeri saymazdı.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // SATIŞ RAPORU
  // ==========================================================================

  /**
   * Tarih aralığındaki satış özeti ve gün bazlı seri.
   *
   * `saleDate` kullanılır, `createdAt` değil: rapor mağazanın SATIŞ gününü
   * anlatır; kaydın sisteme ne zaman girildiğini değil.
   */
  async salesReport(range: DateRange): Promise<SalesReport> {
    const where = this.saleWhere(range);

    const [totals, byStatus, byPaymentType, daily] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _sum: {
          subtotal: true,
          discountTotal: true,
          grandTotal: true,
          paidTotal: true,
          remainingTotal: true,
          costTotal: true,
          additionalCostTotal: true,
          grossProfit: true,
          netProfit: true,
        },
        _count: { _all: true },
      }),
      this.prisma.sale.groupBy({
        by: ['status'],
        where,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.sale.groupBy({
        by: ['paymentType'],
        where,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.dailySalesSeries(range),
    ]);

    const sum = totals._sum;

    return {
      saleCount: totals._count._all,
      subtotal: money(sum.subtotal),
      discountTotal: money(sum.discountTotal),
      grandTotal: money(sum.grandTotal),
      paidTotal: money(sum.paidTotal),
      remainingTotal: money(sum.remainingTotal),
      costTotal: money(sum.costTotal),
      additionalCostTotal: money(sum.additionalCostTotal),
      grossProfit: money(sum.grossProfit),
      netProfit: money(sum.netProfit),
      averageSale:
        totals._count._all === 0
          ? '0'
          : new Prisma.Decimal(sum.grandTotal ?? 0)
              .dividedBy(totals._count._all)
              .toDecimalPlaces(4)
              .toString(),
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        total: money(row._sum.grandTotal),
      })),
      byPaymentType: byPaymentType.map((row) => ({
        paymentType: row.paymentType,
        count: row._count._all,
        total: money(row._sum.grandTotal),
      })),
      daily,
    };
  }

  /** Gün bazlı satış serisi — grafiğin x eksenini boş günlerle birlikte verir. */
  private async dailySalesSeries(range: DateRange): Promise<DailyPoint[]> {
    const rows = await this.prisma.$queryRaw<RawDailyRow[]>`
      SELECT to_char(date_trunc('day', s."saleDate"), 'YYYY-MM-DD') AS "day",
             COUNT(*)::int                                          AS "count",
             COALESCE(SUM(s."grandTotal"), 0)::text                 AS "total",
             COALESCE(SUM(s."grossProfit"), 0)::text                AS "profit"
        FROM "sales" s
       WHERE s."status" = ANY(${REPORTABLE_SALE_STATUSES}::"SaleStatus"[])
         AND s."saleDate" >= ${range.from}
         AND s."saleDate" <= ${range.to}
       GROUP BY 1
       ORDER BY 1
    `;

    return rows.map((row) => ({
      date: row.day,
      count: row.count,
      total: normalize(row.total),
      profit: normalize(row.profit),
    }));
  }

  // ==========================================================================
  // TAHSİLAT RAPORU
  // ==========================================================================

  /** Tahsilat özeti — yöntem kırılımlı (Sprint 10 şartı 5). */
  async paymentReport(range: DateRange): Promise<PaymentReport> {
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      paymentDate: { gte: range.from, lte: range.to },
    };

    const [totals, byMethod, daily] = await Promise.all([
      this.prisma.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<RawDailyPaymentRow[]>`
        SELECT to_char(date_trunc('day', p."paymentDate"), 'YYYY-MM-DD') AS "day",
               COUNT(*)::int                                             AS "count",
               COALESCE(SUM(p."amount"), 0)::text                        AS "total"
          FROM "payments" p
         WHERE p."deletedAt" IS NULL
           AND p."paymentDate" >= ${range.from}
           AND p."paymentDate" <= ${range.to}
         GROUP BY 1
         ORDER BY 1
      `,
    ]);

    return {
      paymentCount: totals._count._all,
      totalAmount: money(totals._sum.amount),
      byMethod: byMethod.map((row) => ({
        method: row.method,
        count: row._count._all,
        total: money(row._sum.amount),
      })),
      daily: daily.map((row) => ({
        date: row.day,
        count: row.count,
        total: normalize(row.total),
      })),
    };
  }

  // ==========================================================================
  // KÂR RAPORU
  // ==========================================================================

  /**
   * Kâr raporu — ürün ve kategori kırılımlı.
   *
   * Kırılım SATIŞ KALEMLERİNDEN hesaplanır, satış başlığından değil: bir
   * satışta birden çok ürün olabilir ve kâr ürün bazında sorulur.
   *
   * EK MALİYETLER (nakliye vb.) kırılıma DAĞITILMAZ, yalnız üst toplamda
   * görünür. Dağıtım anahtarı (tutara mı, ağırlığa mı?) bir muhasebe
   * kararıdır ve şartnamede yok; uydurulmuş bir anahtarla dağıtmak, ürün
   * kârını sessizce yanlış gösterirdi.
   */
  async profitReport(range: DateRange): Promise<ProfitReport> {
    const [header, byProduct, byCategory] = await Promise.all([
      this.prisma.sale.aggregate({
        where: this.saleWhere(range),
        _sum: {
          grandTotal: true,
          costTotal: true,
          additionalCostTotal: true,
          grossProfit: true,
          netProfit: true,
        },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<RawBreakdownRow[]>`
        SELECT COALESCE(i."productId"::text, 'deleted')      AS "key",
               MAX(i."productNameSnapshot")                  AS "label",
               SUM(i."quantity")::text                       AS "quantity",
               SUM(i."lineTotal")::text                      AS "revenue",
               SUM(i."lineCost")::text                       AS "cost",
               SUM(i."lineProfit")::text                     AS "profit",
               COUNT(DISTINCT i."saleId")::int               AS "saleCount"
          FROM "sale_items" i
          JOIN "sales" s ON s."id" = i."saleId"
         WHERE s."status" = ANY(${REPORTABLE_SALE_STATUSES}::"SaleStatus"[])
           AND s."saleDate" >= ${range.from}
           AND s."saleDate" <= ${range.to}
         GROUP BY 1
         ORDER BY SUM(i."lineProfit") DESC
      `,
      // Kategori kırılımı YALNIZ ANA kategoriden gelir: bir ürün birden çok
      // kategoride olabilir ve hepsine sayılsaydı toplam, gerçek ciroyu
      // aşardı.
      this.prisma.$queryRaw<RawBreakdownRow[]>`
        SELECT COALESCE(c."id"::text, 'uncategorized')  AS "key",
               COALESCE(MAX(c."name"), 'Kategorisiz')   AS "label",
               SUM(i."quantity")::text                  AS "quantity",
               SUM(i."lineTotal")::text                 AS "revenue",
               SUM(i."lineCost")::text                  AS "cost",
               SUM(i."lineProfit")::text                AS "profit",
               COUNT(DISTINCT i."saleId")::int          AS "saleCount"
          FROM "sale_items" i
          JOIN "sales" s ON s."id" = i."saleId"
          LEFT JOIN "product_categories" pc
                 ON pc."productId" = i."productId" AND pc."isPrimary" = true
          LEFT JOIN "categories" c ON c."id" = pc."categoryId"
         WHERE s."status" = ANY(${REPORTABLE_SALE_STATUSES}::"SaleStatus"[])
           AND s."saleDate" >= ${range.from}
           AND s."saleDate" <= ${range.to}
         GROUP BY 1
         ORDER BY SUM(i."lineProfit") DESC
      `,
    ]);

    const sum = header._sum;

    return {
      saleCount: header._count._all,
      revenue: money(sum.grandTotal),
      cost: money(sum.costTotal),
      additionalCost: money(sum.additionalCostTotal),
      grossProfit: money(sum.grossProfit),
      netProfit: money(sum.netProfit),
      marginPercent: marginOf(sum.grandTotal, sum.grossProfit),
      byProduct: byProduct.map(toBreakdown),
      byCategory: byCategory.map(toBreakdown),
    };
  }

  // ==========================================================================
  // ALACAKLAR VE YAŞLANDIRMA
  // ==========================================================================

  /**
   * Müşteri bazlı kalan borç + yaşlandırma (Sprint 10 şartı 2).
   *
   * Yaşlandırma SATIŞ BAZINDA yapılır ve müşteri altında toplanır: bir
   * müşterinin iki satışı farklı vadelerde olabilir, tek bir "müşteri yaşı"
   * yanıltıcı olurdu.
   *
   * VADESİZ (peşin ama ödenmemiş) satışlar `NOT_DUE` sayılmaz — vade tarihi
   * yoksa satış tarihinden itibaren yaşlandırılır; aksi hâlde peşin satışın
   * ödenmemiş kalanı hiçbir kovaya düşmez ve tabloda kaybolurdu.
   */
  async receivables(now: Date): Promise<ReceivablesReport> {
    const rows = await this.prisma.$queryRaw<RawReceivableRow[]>`
      SELECT c."id"::text                                    AS "customerId",
             c."code"                                        AS "code",
             c."fullName"                                    AS "fullName",
             c."phone"                                       AS "phone",
             c."creditLimit"::text                           AS "creditLimit",
             COALESCE(SUM(s."remainingTotal"), 0)::text      AS "totalDebt",
             COALESCE(SUM(CASE WHEN COALESCE(s."dueDate", s."saleDate") > ${now}
                               THEN s."remainingTotal" ELSE 0 END), 0)::text AS "notDue",
             COALESCE(SUM(CASE WHEN COALESCE(s."dueDate", s."saleDate") <= ${now}
                                AND ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") <= INTERVAL '30 days'
                               THEN s."remainingTotal" ELSE 0 END), 0)::text AS "days0_30",
             COALESCE(SUM(CASE WHEN ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") > INTERVAL '30 days'
                                AND ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") <= INTERVAL '60 days'
                               THEN s."remainingTotal" ELSE 0 END), 0)::text AS "days31_60",
             COALESCE(SUM(CASE WHEN ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") > INTERVAL '60 days'
                                AND ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") <= INTERVAL '90 days'
                               THEN s."remainingTotal" ELSE 0 END), 0)::text AS "days61_90",
             COALESCE(SUM(CASE WHEN ${now}::timestamptz - COALESCE(s."dueDate", s."saleDate") > INTERVAL '90 days'
                               THEN s."remainingTotal" ELSE 0 END), 0)::text AS "days90Plus",
             MIN(COALESCE(s."dueDate", s."saleDate"))        AS "oldestDueDate"
        FROM "sales" s
        JOIN "customers" c ON c."id" = s."customerId"
       WHERE s."status" = ANY(${OPEN_DEBT_SALE_STATUSES}::"SaleStatus"[])
         AND s."remainingTotal" > 0
         AND c."deletedAt" IS NULL
         -- PERAKENDE KARTI BU EKRANDA GÖRÜNMEZ: bu rapor "bugün kimi
         -- aramalıyım" sorusunu yanıtlar, "Perakende Müşteri" aranamaz.
         -- Kartta bakiye görünmesi bir alacak değil bir işlem anomalisidir
         -- (ör. ödemesi silinmiş ama iptal edilmemiş satış) ve gerçek
         -- borçluları listenin altına iter.
         AND c."code" <> ${RETAIL_CUSTOMER_CODE}
       GROUP BY c."id", c."code", c."fullName", c."phone", c."creditLimit"
       ORDER BY SUM(s."remainingTotal") DESC
    `;

    const customers: ReceivableCustomer[] = rows.map((row) => ({
      customerId: row.customerId,
      code: row.code,
      fullName: row.fullName,
      phone: row.phone,
      creditLimit: normalize(row.creditLimit),
      totalDebt: normalize(row.totalDebt),
      oldestDueDate: row.oldestDueDate?.toISOString() ?? null,
      buckets: {
        NOT_DUE: normalize(row.notDue),
        DAYS_0_30: normalize(row.days0_30),
        DAYS_31_60: normalize(row.days31_60),
        DAYS_61_90: normalize(row.days61_90),
        DAYS_90_PLUS: normalize(row.days90Plus),
      },
    }));

    return {
      customers,
      totalDebt: sumStrings(customers.map((customer) => customer.totalDebt)),
      buckets: Object.fromEntries(
        AGING_BUCKETS.map((bucket) => [
          bucket,
          sumStrings(customers.map((customer) => customer.buckets[bucket])),
        ]),
      ) as Record<AgingBucket, string>,
    };
  }

  // ==========================================================================
  // GRAFİK SERİLERİ (Sprint 10 şartı 6)
  // ==========================================================================

  /** Son 12 ayın satış / tahsilat / kâr serisi. */
  async monthlySeries(now: Date): Promise<MonthlyPoint[]> {
    /*
     * BOŞ AYLAR DA DÖNER: `generate_series` ile takvim üretilip veriye sol
     * join yapılır. Yalnız veri olan aylar dönseydi grafik, satış olmayan
     * ayı hiç göstermez ve düşüşü gizlerdi.
     */
    const rows = await this.prisma.$queryRaw<RawMonthlyRow[]>`
      WITH months AS (
        SELECT generate_series(
                 date_trunc('month', ${now}::timestamptz) - INTERVAL '1 month' * ${CHART_MONTHS - 1},
                 date_trunc('month', ${now}::timestamptz),
                 INTERVAL '1 month'
               ) AS "month"
      ),
      sales_by_month AS (
        SELECT date_trunc('month', s."saleDate") AS "month",
               SUM(s."grandTotal")  AS "total",
               SUM(s."grossProfit") AS "profit",
               COUNT(*)             AS "count"
          FROM "sales" s
         WHERE s."status" = ANY(${REPORTABLE_SALE_STATUSES}::"SaleStatus"[])
         GROUP BY 1
      ),
      payments_by_month AS (
        SELECT date_trunc('month', p."paymentDate") AS "month",
               SUM(p."amount") AS "total"
          FROM "payments" p
         WHERE p."deletedAt" IS NULL
         GROUP BY 1
      )
      SELECT to_char(m."month", 'YYYY-MM')                AS "month",
             COALESCE(s."total", 0)::text                 AS "sales",
             COALESCE(s."profit", 0)::text                AS "profit",
             COALESCE(p."total", 0)::text                 AS "payments",
             COALESCE(s."count", 0)::int                  AS "saleCount"
        FROM months m
        LEFT JOIN sales_by_month s ON s."month" = m."month"
        LEFT JOIN payments_by_month p ON p."month" = m."month"
       ORDER BY m."month"
    `;

    return rows.map((row) => ({
      month: row.month,
      sales: normalize(row.sales),
      payments: normalize(row.payments),
      profit: normalize(row.profit),
      saleCount: row.saleCount,
    }));
  }

  /** En çok satan ürünler — ciroya göre. */
  async topProducts(range: DateRange, limit = TOP_LIST_LIMIT): Promise<TopProduct[]> {
    const rows = await this.prisma.$queryRaw<RawTopProductRow[]>`
      SELECT COALESCE(i."productId"::text, 'deleted') AS "productId",
             MAX(i."productNameSnapshot")             AS "name",
             SUM(i."quantity")::text                  AS "quantity",
             SUM(i."lineTotal")::text                 AS "revenue",
             SUM(i."lineProfit")::text                AS "profit"
        FROM "sale_items" i
        JOIN "sales" s ON s."id" = i."saleId"
       WHERE s."status" = ANY(${REPORTABLE_SALE_STATUSES}::"SaleStatus"[])
         AND s."saleDate" >= ${range.from}
         AND s."saleDate" <= ${range.to}
       GROUP BY 1
       ORDER BY SUM(i."lineTotal") DESC
       LIMIT ${limit}
    `;

    return rows.map((row) => ({
      ...row,
      quantity: normalize(row.quantity),
      revenue: normalize(row.revenue),
      profit: normalize(row.profit),
    }));
  }

  /** En çok borcu olan müşteriler. */
  async topDebtors(limit = TOP_LIST_LIMIT): Promise<TopDebtor[]> {
    const rows = await this.prisma.$queryRaw<RawTopDebtorRow[]>`
      SELECT c."id"::text                          AS "customerId",
             c."code"                              AS "code",
             c."fullName"                          AS "fullName",
             SUM(s."remainingTotal")::text         AS "debt"
        FROM "sales" s
        JOIN "customers" c ON c."id" = s."customerId"
       WHERE s."status" = ANY(${OPEN_DEBT_SALE_STATUSES}::"SaleStatus"[])
         AND s."remainingTotal" > 0
         AND c."deletedAt" IS NULL
         -- PERAKENDE KARTI BU EKRANDA GÖRÜNMEZ: bu rapor "bugün kimi
         -- aramalıyım" sorusunu yanıtlar, "Perakende Müşteri" aranamaz.
         -- Kartta bakiye görünmesi bir alacak değil bir işlem anomalisidir
         -- (ör. ödemesi silinmiş ama iptal edilmemiş satış) ve gerçek
         -- borçluları listenin altına iter.
         AND c."code" <> ${RETAIL_CUSTOMER_CODE}
       GROUP BY c."id", c."code", c."fullName"
       ORDER BY SUM(s."remainingTotal") DESC
       LIMIT ${limit}
    `;

    return rows.map((row) => ({ ...row, debt: normalize(row.debt) }));
  }

  // ==========================================================================
  // ORTAK
  // ==========================================================================

  /** Raporlanabilir satış filtresi — tek yerden. */
  private saleWhere(range: DateRange): Prisma.SaleWhereInput {
    return {
      status: { in: REPORTABLE_SALE_STATUSES as SaleStatus[] },
      saleDate: { gte: range.from, lte: range.to },
    };
  }
}

// =============================================================================
// TİPLER
// =============================================================================

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DailyPoint {
  date: string;
  count: number;
  total: string;
  profit?: string;
}

export interface SalesReport {
  saleCount: number;
  subtotal: string;
  discountTotal: string;
  grandTotal: string;
  paidTotal: string;
  remainingTotal: string;
  costTotal: string;
  additionalCostTotal: string;
  grossProfit: string;
  netProfit: string;
  averageSale: string;
  byStatus: { status: string; count: number; total: string }[];
  byPaymentType: { paymentType: string; count: number; total: string }[];
  daily: DailyPoint[];
}

export interface PaymentReport {
  paymentCount: number;
  totalAmount: string;
  byMethod: { method: string; count: number; total: string }[];
  daily: { date: string; count: number; total: string }[];
}

export interface BreakdownRow {
  key: string;
  label: string;
  quantity: string;
  revenue: string;
  cost: string;
  profit: string;
  saleCount: number;
  marginPercent: string;
}

export interface ProfitReport {
  saleCount: number;
  revenue: string;
  cost: string;
  additionalCost: string;
  grossProfit: string;
  netProfit: string;
  marginPercent: string;
  byProduct: BreakdownRow[];
  byCategory: BreakdownRow[];
}

export interface ReceivableCustomer {
  customerId: string;
  code: string;
  fullName: string;
  phone: string;
  creditLimit: string;
  totalDebt: string;
  oldestDueDate: string | null;
  buckets: Record<AgingBucket, string>;
}

export interface ReceivablesReport {
  customers: ReceivableCustomer[];
  totalDebt: string;
  buckets: Record<AgingBucket, string>;
}

export interface MonthlyPoint {
  month: string;
  sales: string;
  payments: string;
  profit: string;
  saleCount: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: string;
  revenue: string;
  profit: string;
}

export interface TopDebtor {
  customerId: string;
  code: string;
  fullName: string;
  debt: string;
}

// --- Ham sorgu satırları (sayısal alanlar ::text ile gelir) ---

interface RawDailyRow {
  day: string;
  count: number;
  total: string;
  profit: string;
}

interface RawDailyPaymentRow {
  day: string;
  count: number;
  total: string;
}

interface RawBreakdownRow {
  key: string;
  label: string;
  quantity: string;
  revenue: string;
  cost: string;
  profit: string;
  saleCount: number;
}

interface RawReceivableRow {
  customerId: string;
  code: string;
  fullName: string;
  phone: string;
  creditLimit: string;
  totalDebt: string;
  notDue: string;
  days0_30: string;
  days31_60: string;
  days61_90: string;
  days90Plus: string;
  oldestDueDate: Date | null;
}

interface RawMonthlyRow {
  month: string;
  sales: string;
  profit: string;
  payments: string;
  saleCount: number;
}

interface RawTopProductRow {
  productId: string;
  name: string;
  quantity: string;
  revenue: string;
  profit: string;
}

interface RawTopDebtorRow {
  customerId: string;
  code: string;
  fullName: string;
  debt: string;
}

// =============================================================================
// YARDIMCILAR
// =============================================================================

/**
 * Ham SQL'den gelen sayısal metni tek biçime indirger.
 *
 * NEDEN GEREKLİ: `SUM(x)::text` PostgreSQL'de kolonun ölçeğiyle döner —
 * "3000.0000". Prisma'nın `aggregate` yolu ise Decimal üretir ve "3000"
 * yazar. İkisi normalize edilmeseydi aynı tutar, aynı yanıtın iki farklı
 * alanında iki farklı metin olurdu; istemcinin string karşılaştırması ve
 * testler bunun üzerine kurulamazdı.
 */
function normalize(value: string): string {
  return new Prisma.Decimal(value).toString();
}

/** Prisma toplamı string'e çevirir; null toplam sıfırdır. */
function money(value: Prisma.Decimal | null): string {
  return new Prisma.Decimal(value ?? 0).toString();
}

/** Kâr marjı yüzdesi. Ciro sıfırsa marj tanımsızdır; "0" döner. */
function marginOf(revenue: Prisma.Decimal | null, profit: Prisma.Decimal | null): string {
  const total = new Prisma.Decimal(revenue ?? 0);

  if (total.isZero()) {
    return '0';
  }

  return new Prisma.Decimal(profit ?? 0).dividedBy(total).times(100).toDecimalPlaces(2).toString();
}

function toBreakdown(row: RawBreakdownRow): BreakdownRow {
  return {
    ...row,
    quantity: normalize(row.quantity),
    revenue: normalize(row.revenue),
    cost: normalize(row.cost),
    profit: normalize(row.profit),
    marginPercent: marginOf(new Prisma.Decimal(row.revenue), new Prisma.Decimal(row.profit)),
  };
}

/** Metin hâlindeki tutarları Decimal ile toplar (Kural 2). */
function sumStrings(values: string[]): string {
  return values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toDecimalPlaces(4)
    .toString();
}
