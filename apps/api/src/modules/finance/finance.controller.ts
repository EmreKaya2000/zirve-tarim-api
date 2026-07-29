import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ReportsService, type DateRange } from '../reports/reports.service';

import { DashboardService } from './dashboard.service';
import { FinanceService } from './finance.service';
import { OverdueQueryDto, ReportRangeQueryDto, TopListQueryDto } from './dto/finance.dto';

/**
 * Finans ve raporlar (admin).
 *
 * TEK CONTROLLER, İKİ MODÜL: uçların tamamı `/admin/finance` altındadır
 * (Sprint 10 şartı 1-6) ama ağır toplama sorguları ayrı bir modülde
 * (`ReportsModule` → `ReportsService`) durur. Bölme sebebi yol değil
 * sorumluluk: rapor sorguları ham SQL ve performans işidir, dashboard ise
 * onları bir ekran için birleştirir.
 *
 * TÜM RAPORLAR SALT OKUNURDUR — bu controller'da hiçbir yazma ucu yoktur.
 */
@ApiTags('Finans')
@ApiBearerAuth('access-token')
@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly finance: FinanceService,
    private readonly reports: ReportsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Yönetim paneli metrikleri',
    description: [
      'Katalog ve müşteri sayıları, bekleyen talepler, bu ayki satış/tahsilat/kâr,',
      'toplam ve vadesi geçmiş borç, kritik stok sayısı, son işlemler,',
      'yaklaşan vadeler (7 gün) ve son 12 ayın serisi.',
      '',
      'TEK İSTEK: bütün kartlar aynı anın verisini gösterir.',
    ].join('\n'),
  })
  async dashboardData() {
    return this.dashboard.build(new Date());
  }

  @Get('receivables')
  @ApiOperation({
    summary: 'Alacaklar ve yaşlandırma',
    description:
      'Müşteri bazlı kalan borç; 0-30 / 31-60 / 61-90 / 90+ gün kovaları. ' +
      'Vadesi gelmemiş alacak AYRI kovadadır — gecikmiş sayılmaz.',
  })
  async receivables() {
    return this.reports.receivables(new Date());
  }

  @Get('overdue')
  @ApiOperation({
    summary: 'Vadesi geçmiş satışlar',
    description:
      '`dueDate < bugün` ve `remainingTotal > 0`. Gecikme gün sayısı sunucuda hesaplanır.',
  })
  async overdue(@Query() query: OverdueQueryDto) {
    return this.finance.overdueSales(query, new Date());
  }

  @Get('sales-report')
  @ApiOperation({
    summary: 'Satış raporu',
    description:
      'Tarih aralığı; durum ve ödeme tipi kırılımı, gün bazlı seri. ' +
      'İPTAL ve TASLAK satışlar hariçtir.',
  })
  async salesReport(@Query() query: ReportRangeQueryDto) {
    return this.reports.salesReport(resolveRange(query));
  }

  @Get('payment-report')
  @ApiOperation({
    summary: 'Tahsilat raporu',
    description:
      'Tarih aralığı; ÖDEME YÖNTEMİ kırılımı ve gün bazlı seri. Silinmiş ödemeler hariç.',
  })
  async paymentReport(@Query() query: ReportRangeQueryDto) {
    return this.reports.paymentReport(resolveRange(query));
  }

  @Get('profit-report')
  @ApiOperation({
    summary: 'Kâr raporu',
    description: [
      'Tarih aralığı; brüt ve net kâr, ürün ve kategori kırılımı.',
      '',
      'Ek maliyetler kırılıma DAĞITILMAZ, yalnız üst toplamda görünür:',
      'dağıtım anahtarı bir muhasebe kararıdır ve şartnamede tanımlı değildir.',
    ].join('\n'),
  })
  async profitReport(@Query() query: ReportRangeQueryDto) {
    return this.reports.profitReport(resolveRange(query));
  }

  @Get('charts')
  @ApiOperation({
    summary: 'Grafik serileri',
    description:
      'Son 12 ayın satış/tahsilat/kâr serisi, en çok satan ürünler, en çok borcu olan müşteriler ' +
      've kategori bazlı satış dağılımı.',
  })
  async charts(@Query() query: TopListQueryDto) {
    const range = resolveRange(query);

    const [monthly, topProducts, topDebtors, profit] = await Promise.all([
      this.reports.monthlySeries(new Date()),
      this.reports.topProducts(range, query.limit),
      this.reports.topDebtors(query.limit),
      this.reports.profitReport(range),
    ]);

    return {
      monthly,
      topProducts,
      topDebtors,
      // Kategori dağılımı kâr raporunun kırılımından gelir; ikinci bir
      // sorgu yazmak aynı hesabı iki yerde tutmak olurdu.
      byCategory: profit.byCategory,
    };
  }
}

/**
 * Tarih aralığını çözer; verilmezse İÇİNDE BULUNULAN AY.
 *
 * Varsayılanın "tüm zamanlar" olmaması bilinçlidir: rapor ekranı ilk
 * açılışta tam tablo taraması yapmamalıdır.
 */
function resolveRange(query: ReportRangeQueryDto): DateRange {
  const now = new Date();

  const from =
    query.dateFrom === undefined
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      : new Date(query.dateFrom);

  const to =
    query.dateTo === undefined
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
      : new Date(query.dateTo);

  return { from, to };
}
