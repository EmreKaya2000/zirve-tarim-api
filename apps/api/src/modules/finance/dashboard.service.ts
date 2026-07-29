import { Injectable } from '@nestjs/common';
import { InquiryStatus, Prisma, SaleStatus } from '@prisma/client';
import {
  OPEN_DEBT_SALE_STATUSES,
  RECENT_LIST_LIMIT,
  REPORTABLE_SALE_STATUSES,
  UPCOMING_DUE_DAYS,
} from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  ReportsService,
  type MonthlyPoint,
  type TopDebtor,
  type TopProduct,
} from '../reports/reports.service';

/**
 * Talebin "bekliyor" sayıldığı durumlar.
 *
 * Uç durumlar (dönüşmüş, tamamlanmış, reddedilmiş, iptal) beklemez.
 * NEW ayrıca kendi başına da sayılır: mağaza sahibinin ilk baktığı rakam
 * "bugün kaç yeni talep geldi"dir.
 */
const PENDING_INQUIRY_STATUSES: InquiryStatus[] = [
  InquiryStatus.NEW,
  InquiryStatus.REVIEWING,
  InquiryStatus.CONTACTED,
  InquiryStatus.QUOTED,
  InquiryStatus.APPROVED,
];

/**
 * Dashboard metrikleri (Sprint 10 şartı 1).
 *
 * TEK İSTEK, TEK EKRAN: dashboard'un tamamı bu serviste toplanır ve
 * paralel sorgularla çekilir. Her kart ayrı uçtan beslenseydi sayfa
 * açılışında 12 istek atılır, hepsi ayrı ayrı yavaşlar ve kartlar
 * birbirinden farklı anların verisini gösterirdi.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async build(now: Date): Promise<DashboardData> {
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const upcomingUntil = addDays(now, UPCOMING_DUE_DAYS);

    const [catalog, inquiries, month, debt, criticalStock, recent, upcoming, series, tops] =
      await Promise.all([
        this.catalogCounts(),
        this.inquiryCounts(),
        this.monthTotals(monthStart, monthEnd),
        this.debtTotals(now),
        this.criticalStockCount(),
        this.recentActivity(),
        this.upcomingDueSales(now, upcomingUntil),
        this.reports.monthlySeries(now),
        this.topLists(monthStart, monthEnd),
      ]);

    return {
      generatedAt: now.toISOString(),
      catalog,
      inquiries,
      month,
      debt,
      criticalStockCount: criticalStock,
      recent,
      upcomingDueSales: upcoming,
      monthlySeries: series,
      ...tops,
    };
  }

  // ==========================================================================
  // PARÇALAR
  // ==========================================================================

  /** Aktif katalog ve müşteri sayıları. */
  private async catalogCounts(): Promise<CatalogCounts> {
    const [products, categories, brands, customers] = await Promise.all([
      this.prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.category.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.brand.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
    ]);

    return { activeProducts: products, categories, brands, activeCustomers: customers };
  }

  private async inquiryCounts(): Promise<InquiryCounts> {
    const [pending, fresh] = await Promise.all([
      this.prisma.inquiry.count({
        where: { deletedAt: null, status: { in: PENDING_INQUIRY_STATUSES } },
      }),
      this.prisma.inquiry.count({ where: { deletedAt: null, status: InquiryStatus.NEW } }),
    ]);

    return { pending, new: fresh };
  }

  /** Bu ayki satış, tahsilat ve kâr. */
  private async monthTotals(from: Date, to: Date): Promise<MonthTotals> {
    const [sales, payments] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          status: { in: REPORTABLE_SALE_STATUSES as SaleStatus[] },
          saleDate: { gte: from, lte: to },
        },
        _sum: { grandTotal: true, grossProfit: true, netProfit: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { deletedAt: null, paymentDate: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      saleCount: sales._count._all,
      salesTotal: decimalToString(sales._sum.grandTotal),
      grossProfit: decimalToString(sales._sum.grossProfit),
      netProfit: decimalToString(sales._sum.netProfit),
      paymentCount: payments._count._all,
      paymentsTotal: decimalToString(payments._sum.amount),
    };
  }

  /**
   * Toplam açık borç ve vadesi geçmiş borç.
   *
   * DEVİR BAKİYELERİ DE DAHİLDİR: sisteme geçişte taşınan borç, satış
   * kaydı olmadığı için `sales` toplamında görünmez; dışarıda bırakılsaydı
   * dashboard'daki alacak, müşteri kartlarının toplamından küçük çıkardı.
   */
  private async debtTotals(now: Date): Promise<DebtTotals> {
    const [open, overdue, opening, paid, allSales] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { status: { in: OPEN_DEBT_SALE_STATUSES as SaleStatus[] } },
        _sum: { remainingTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          status: { in: OPEN_DEBT_SALE_STATUSES as SaleStatus[] },
          dueDate: { lt: now },
        },
        _sum: { remainingTotal: true },
        _count: { _all: true },
      }),
      this.prisma.customer.aggregate({
        where: { deletedAt: null },
        _sum: { openingBalance: true },
      }),
      this.prisma.payment.aggregate({ where: { deletedAt: null }, _sum: { amount: true } }),
      this.prisma.sale.aggregate({
        where: { status: { in: REPORTABLE_SALE_STATUSES as SaleStatus[] } },
        _sum: { grandTotal: true },
      }),
    ]);

    // Devir bakiyesinin ne kadarının kapandığı satış kalanından okunamaz;
    // müşteri kartındaki formülün aynısı uygulanır:
    //   borç = devir + satış toplamı - tahsilat
    const totalDebt = new Prisma.Decimal(opening._sum.openingBalance ?? 0)
      .plus(allSales._sum.grandTotal ?? 0)
      .minus(paid._sum.amount ?? 0)
      .toDecimalPlaces(4);

    return {
      totalDebt: totalDebt.toString(),
      openSalesDebt: decimalToString(open._sum.remainingTotal),
      overdueDebt: decimalToString(overdue._sum.remainingTotal),
      overdueSaleCount: overdue._count._all,
    };
  }

  /**
   * Kritik stok sayısı.
   *
   * İki kolonun karşılaştırılması Prisma'nın alan referansıyla yapılır;
   * stok modülündeki kuralla AYNI ifadedir (`stockQuantity <= threshold`).
   */
  private async criticalStockCount(): Promise<number> {
    return this.prisma.productVariant.count({
      where: {
        deletedAt: null,
        isActive: true,
        trackStock: true,
        product: { deletedAt: null },
        stockQuantity: { lte: this.prisma.productVariant.fields.lowStockThreshold },
      },
    });
  }

  private async recentActivity(): Promise<RecentActivity> {
    const [sales, payments, inquiries, criticalVariants] = await Promise.all([
      this.prisma.sale.findMany({
        where: { status: { not: SaleStatus.DRAFT } },
        orderBy: { saleDate: 'desc' },
        take: RECENT_LIST_LIMIT,
        select: {
          id: true,
          saleNumber: true,
          status: true,
          grandTotal: true,
          saleDate: true,
          customer: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { deletedAt: null },
        orderBy: { paymentDate: 'desc' },
        take: RECENT_LIST_LIMIT,
        select: {
          id: true,
          paymentNumber: true,
          method: true,
          amount: true,
          paymentDate: true,
          customer: { select: { id: true, fullName: true } },
          sale: { select: { id: true, saleNumber: true } },
        },
      }),
      this.prisma.inquiry.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIST_LIMIT,
        select: {
          id: true,
          inquiryNumber: true,
          status: true,
          contactName: true,
          estimatedTotal: true,
          createdAt: true,
        },
      }),
      this.prisma.productVariant.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          trackStock: true,
          product: { deletedAt: null },
          stockQuantity: { lte: this.prisma.productVariant.fields.lowStockThreshold },
        },
        orderBy: { stockQuantity: 'asc' },
        take: RECENT_LIST_LIMIT,
        select: {
          id: true,
          sku: true,
          name: true,
          stockQuantity: true,
          lowStockThreshold: true,
          unitType: { select: { code: true } },
          product: { select: { id: true, name: true } },
        },
      }),
    ]);

    return { sales, payments, inquiries, criticalStock: criticalVariants };
  }

  /** Önümüzdeki 7 gün içinde vadesi dolacak satışlar. */
  private async upcomingDueSales(now: Date, until: Date): Promise<unknown[]> {
    return this.prisma.sale.findMany({
      where: {
        status: { in: OPEN_DEBT_SALE_STATUSES as SaleStatus[] },
        remainingTotal: { gt: 0 },
        dueDate: { gte: now, lte: until },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        saleNumber: true,
        dueDate: true,
        remainingTotal: true,
        customer: { select: { id: true, fullName: true, phone: true } },
      },
    });
  }

  private async topLists(
    from: Date,
    to: Date,
  ): Promise<{ topProducts: TopProduct[]; topDebtors: TopDebtor[] }> {
    const [topProducts, topDebtors] = await Promise.all([
      this.reports.topProducts({ from, to }),
      this.reports.topDebtors(),
    ]);

    return { topProducts, topDebtors };
  }
}

// =============================================================================
// TİPLER
// =============================================================================

export interface CatalogCounts {
  activeProducts: number;
  categories: number;
  brands: number;
  activeCustomers: number;
}

export interface InquiryCounts {
  pending: number;
  new: number;
}

export interface MonthTotals {
  from: string;
  to: string;
  saleCount: number;
  salesTotal: string;
  grossProfit: string;
  netProfit: string;
  paymentCount: number;
  paymentsTotal: string;
}

export interface DebtTotals {
  totalDebt: string;
  openSalesDebt: string;
  overdueDebt: string;
  overdueSaleCount: number;
}

export interface RecentActivity {
  sales: unknown[];
  payments: unknown[];
  inquiries: unknown[];
  criticalStock: unknown[];
}

export interface DashboardData {
  generatedAt: string;
  catalog: CatalogCounts;
  inquiries: InquiryCounts;
  month: MonthTotals;
  debt: DebtTotals;
  criticalStockCount: number;
  recent: RecentActivity;
  upcomingDueSales: unknown[];
  monthlySeries: MonthlyPoint[];
  topProducts: TopProduct[];
  topDebtors: TopDebtor[];
}

// =============================================================================
// TARİH YARDIMCILARI
// =============================================================================

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function decimalToString(value: Prisma.Decimal | null): string {
  return new Prisma.Decimal(value ?? 0).toString();
}
