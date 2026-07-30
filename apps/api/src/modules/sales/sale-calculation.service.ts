import { Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';

/**
 * Satış para matematiğinin TEK KAYNAĞI.
 *
 * ==========================================================================
 * KARAR: TÜRETİLMİŞ TOPLAMLAR VERİTABANINDA SAKLANIR (Sprint 8 şartı 4)
 * ==========================================================================
 *
 * `paidTotal`, `remainingTotal`, `grossProfit`, `netProfit` ve arkadaşları
 * her okumada yeniden hesaplanmıyor; `sales` tablosunda STORED tutuluyor.
 *
 * GEREKÇE: raporlama. "Bu ay ne kadar kâr ettim", "vadesi geçmiş toplam
 * borç ne", "en kârlı 10 ürün" gibi sorgular, kâr alanları saklanmazsa her
 * satışın kalemlerini ve ödemelerini join edip toplamak zorunda kalır.
 * Binlerce satışta bu, saniyeler süren bir rapor demek. Saklanan alanla
 * aynı rapor tek tablo taramasıyla çıkar.
 *
 * BEDELİ: ikinci bir gerçek kaynağı. Bu bedel üç katmanla ödeniyor:
 *
 *   1. TEK YAZAR: bu servis. Kalem, ödeme veya ek maliyet değişen her yer
 *      `recalculate()` çağırır; başka hiçbir kod bu alanlara yazmaz.
 *   2. AYNI TRANSACTION: hesaplama, değişikliği yapan transaction'ın
 *      içinde çalışır. Yarıda kalan bir güncelleme tutarsız toplam
 *      bırakmaz (Kural 6).
 *   3. VERİTABANI KISITI: `chk_sales_remaining_consistent` alanların
 *      birbirine göre bozulmasını INSERT/UPDATE anında yakalar. Kod
 *      unutsa bile veritabanı tutmaz.
 *
 * Ayrıca `verifyConsistency()` ile bir satışın saklanan toplamları kalem
 * ve ödemelerden yeniden hesaplanıp karşılaştırılabilir; testler bunu
 * kullanır.
 *
 * ==========================================================================
 * KURAL 2: hiçbir hesap JS float ile yapılmaz
 * ==========================================================================
 * Tüm aritmetik `Prisma.Decimal` üzerindedir. `0.1 + 0.2` JS'te
 * 0.30000000000000004'tür; kuruş kaybı raporda yıl sonunda ortaya çıkar
 * ve kaynağı bulunamaz.
 */
@Injectable()
export class SaleCalculationService {
  /** Para alanlarının ondalık basamağı (Decimal(18,4)). */
  private static readonly MONEY_SCALE = 4;

  /**
   * Bir satış kalemini hesaplar.
   *
   * Formüller:
   *   lineSubtotal = unitSalePrice * quantity
   *   lineTotal    = lineSubtotal - discountAmount
   *   lineCost     = unitPurchasePrice * quantity
   *   lineTax      = lineTotal * taxRate / (100 + taxRate)     <- ters hesap
   *   lineProfit   = (lineTotal - lineTax) - (lineCost - costTax)
   *
   * `lineProfit` NEGATİF olabilir ve bu bilinçlidir: elde kalan malı
   * maliyetin altında çıkarmak gerçek bir iş kararıdır. Sıfıra
   * kırpılsaydı zarar raporda görünmez olurdu.
   *
   * ==========================================================================
   * KDV KURALI — fiyat girilen orana göre DAHİL sayılır
   * ==========================================================================
   * Karar (2026-07-30, şartname §9.1 "KDV bilgisi opsiyonel olabilir"):
   *
   *   taxRate > 0  -> `unitSalePrice` KDV DAHİLDİR. KDV ters hesapla
   *                   ayrıştırılır; müşterinin ödediği tutar DEĞİŞMEZ.
   *   taxRate = 0  -> KDV yoktur. Kalem tamamen net sayılır.
   *
   * `grandTotal` bu karardan ETKİLENMEZ: KDV dahil fiyatta vergi, ödenen
   * tutarın içinden çıkar; üstüne eklenmez. `taxTotal` bir kırılımdır.
   *
   * KÂR NET TUTAR ÜZERİNDEN HESAPLANIR. Bu ayrıntı kritik: KDV mağazanın
   * parası değil, devlet adına toplanır ve ciroya yazılamaz. Ham
   * `lineTotal - lineCost` kullanılsaydı %20 oranda kâr TAM %20 fazla
   * görünürdü — finans modülünün asıl çıktısı yanlış olurdu.
   *
   * Alış fiyatı da aynı oranla netleştirilir: aynı ürünün alışı ve satışı
   * aynı KDV oranına tabidir ve işletme girdi KDV'sini indirir. Yalnız satış
   * tarafı netleştirilseydi kâr bu kez EKSİK görünürdü.
   */
  calculateItem(input: SaleItemInput): CalculatedSaleItem {
    const quantity = this.decimal(input.quantity);
    const unitSalePrice = this.decimal(input.unitSalePrice);
    const unitPurchasePrice = this.decimal(input.unitPurchasePrice);
    const discountAmount = this.decimal(input.discountAmount ?? 0);
    const taxRate = this.decimal(input.taxRate ?? 0);

    const lineSubtotal = this.money(unitSalePrice.times(quantity));
    const lineTotal = this.money(lineSubtotal.minus(discountAmount));
    const lineCost = this.money(unitPurchasePrice.times(quantity));

    // Ters hesap: KDV dahil tutardan vergiyi çıkarır.
    // 120 TL ve %20 -> 120 * 20 / 120 = 20 TL vergi, 100 TL net.
    const lineTax = this.money(this.extractTax(lineTotal, taxRate));
    const costTax = this.money(this.extractTax(lineCost, taxRate));

    const lineProfit = this.money(lineTotal.minus(lineTax).minus(lineCost.minus(costTax)));

    return {
      quantity,
      unitSalePrice,
      unitPurchasePrice,
      discountAmount,
      taxRate,
      lineSubtotal,
      lineTotal,
      lineCost,
      lineTax,
      lineProfit,
    };
  }

  /**
   * Satış toplamlarını kalemlerden, ödemelerden ve ek maliyetlerden
   * yeniden hesaplar ve `sales` satırını günceller.
   *
   * @param tx ÇAĞIRAN TRANSACTION. Ayrı bir bağlantıda çalıştırılırsa
   *   atomiklik kaybolur ve toplamlar tutarsız kalabilir.
   */
  async recalculate(tx: Prisma.TransactionClient, saleId: string): Promise<SaleTotals> {
    const [items, additionalCosts, paymentAggregate, sale] = await Promise.all([
      tx.saleItem.findMany({
        where: { saleId },
        select: {
          lineSubtotal: true,
          lineTotal: true,
          lineCost: true,
          discountAmount: true,
          // KDV ve NET kâr toplamları bu iki alandan gelir.
          lineTax: true,
          lineProfit: true,
        },
      }),
      tx.saleAdditionalCost.findMany({ where: { saleId }, select: { amount: true } }),
      // Soft delete edilmiş ödeme SAYILMAZ: yanlış girilmiş bir tahsilat
      // silindiğinde borç yeniden doğmalıdır.
      tx.payment.aggregate({
        where: { saleId, deletedAt: null },
        _sum: { amount: true },
      }),
      tx.sale.findUniqueOrThrow({ where: { id: saleId }, select: { status: true } }),
    ]);

    const totals = this.computeTotals({
      items,
      additionalCosts,
      paidTotal: paymentAggregate._sum.amount ?? new Prisma.Decimal(0),
    });

    const status = this.resolveStatus(sale.status, totals);

    await tx.sale.update({
      where: { id: saleId },
      data: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        paidTotal: totals.paidTotal,
        remainingTotal: totals.remainingTotal,
        costTotal: totals.costTotal,
        additionalCostTotal: totals.additionalCostTotal,
        grossProfit: totals.grossProfit,
        netProfit: totals.netProfit,
        status,
      },
    });

    return { ...totals, status };
  }

  /**
   * Toplamları saf fonksiyon olarak hesaplar.
   *
   * Veritabanına dokunmaz; hem `recalculate()` hem birim testler kullanır.
   *
   * Formüller (Sprint 8 şartı 3):
   *   subtotal      = Σ lineSubtotal
   *   discountTotal = Σ discountAmount
   *   taxTotal      = Σ lineTax        (KDV DAHİL tutarların içinden ayrışan)
   *   grandTotal    = subtotal - discountTotal
   *   grossProfit   = Σ lineProfit     (NET tutarlar üzerinden)
   *   netProfit     = grossProfit - additionalCostTotal
   *
   * DİKKAT — `taxTotal` grandTotal'a EKLENMEZ. Fiyatlar KDV dahil olduğu için
   * vergi zaten `subtotal`ın içindedir; toplansa müşteriden vergi iki kez
   * alınmış olurdu. `taxTotal` fatura ve raporlama için bir KIRILIMDIR.
   */
  computeTotals(input: TotalsInput): SaleTotals {
    const zero = new Prisma.Decimal(0);

    const subtotal = input.items.reduce(
      (sum, item) => sum.plus(this.decimal(item.lineSubtotal)),
      zero,
    );
    const discountTotal = input.items.reduce(
      (sum, item) => sum.plus(this.decimal(item.discountAmount)),
      zero,
    );
    const costTotal = input.items.reduce(
      (sum, item) => sum.plus(this.decimal(item.lineCost)),
      zero,
    );

    // KDV, kalemlerin içinden ayrışan payların toplamıdır. Oranı 0 olan
    // kalemler sıfır katkı verir ("KDV değeri girilmezse hariç").
    const taxTotal = input.items.reduce((sum, item) => sum.plus(this.decimal(item.lineTax)), zero);

    // KDV EKLENMEZ — gerekçe yukarıdaki formül bloğunda.
    const grandTotal = this.money(subtotal.minus(discountTotal));

    const additionalCostTotal = input.additionalCosts.reduce(
      (sum, cost) => sum.plus(this.decimal(cost.amount)),
      zero,
    );

    /*
     * grossProfit KALEM KÂRLARININ TOPLAMIDIR — `lineTotal - lineCost` değil.
     *
     * İkisi eskiden aynı sonucu veriyordu (KDV sıfırdı). Artık vermez:
     * `lineProfit` NET tutarlar üzerinden hesaplanıyor, ham fark ise KDV'yi
     * de kâr sayar ve %20 oranda kârı tam %20 şişirirdi. Kalem alanından
     * toplamak ayrıca satır düzeyinde denetlenebilirlik sağlar.
     */
    const grossProfit = this.money(
      input.items.reduce((sum, item) => sum.plus(this.decimal(item.lineProfit)), zero),
    );

    const netProfit = this.money(grossProfit.minus(additionalCostTotal));

    const paidTotal = this.money(this.decimal(input.paidTotal));
    const remainingTotal = this.money(grandTotal.minus(paidTotal));

    return {
      subtotal: this.money(subtotal),
      discountTotal: this.money(discountTotal),
      taxTotal: this.money(taxTotal),
      grandTotal,
      paidTotal,
      remainingTotal,
      costTotal: this.money(costTotal),
      additionalCostTotal: this.money(additionalCostTotal),
      grossProfit,
      netProfit,
      status: 'DRAFT',
    };
  }

  /**
   * Ödeme durumuna göre satış durumunu belirler.
   *
   * DRAFT ve CANCELLED DEĞİŞMEZ: taslak satışa ödeme eklenemez, iptal
   * edilmiş satışın durumu ödemeyle geri döndürülemez.
   *
   * Onaylanmış satışta:
   *   ödeme yok            -> CONFIRMED
   *   kısmi ödeme          -> PARTIALLY_PAID
   *   tamamı ödendi        -> PAID
   */
  resolveStatus(
    current: SaleStatus,
    totals: Pick<SaleTotals, 'grandTotal' | 'paidTotal'>,
  ): SaleStatus {
    if (current === SaleStatus.DRAFT || current === SaleStatus.CANCELLED) {
      return current;
    }

    if (totals.paidTotal.lessThanOrEqualTo(0)) {
      return SaleStatus.CONFIRMED;
    }

    // Sıfır tutarlı bir satış (tamamı indirimli) onaylandığı anda ödenmiş
    // sayılır: tahsil edilecek bir şey yok.
    if (totals.paidTotal.greaterThanOrEqualTo(totals.grandTotal)) {
      return SaleStatus.PAID;
    }

    return SaleStatus.PARTIALLY_PAID;
  }

  /**
   * Saklanan toplamların kalem ve ödemelerle tutarlı olup olmadığını
   * denetler.
   *
   * Testlerin ve ileride eklenebilecek bir bakım komutunun kullanması
   * için. Stored alan kararının (şart 4) "tutarlılık testle güvence
   * altına alınır" maddesinin karşılığı budur.
   */
  async verifyConsistency(
    tx: Prisma.TransactionClient,
    saleId: string,
  ): Promise<ConsistencyReport> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        status: true,
        subtotal: true,
        discountTotal: true,
        grandTotal: true,
        paidTotal: true,
        remainingTotal: true,
        costTotal: true,
        additionalCostTotal: true,
        grossProfit: true,
        netProfit: true,
        items: {
          select: {
            lineSubtotal: true,
            lineTotal: true,
            lineCost: true,
            discountAmount: true,
            // KDV ve NET kâr toplamları bu iki alandan gelir.
            lineTax: true,
            lineProfit: true,
          },
        },
        additionalCosts: { select: { amount: true } },
        payments: { where: { deletedAt: null }, select: { amount: true } },
      },
    });

    const expected = this.computeTotals({
      items: sale.items,
      additionalCosts: sale.additionalCosts,
      paidTotal: sale.payments.reduce(
        (sum, payment) => sum.plus(payment.amount),
        new Prisma.Decimal(0),
      ),
    });

    const mismatches: string[] = [];
    const compare = (field: keyof SaleTotals & keyof typeof sale): void => {
      const stored = this.decimal(sale[field] as Prisma.Decimal);
      const computed = expected[field] as Prisma.Decimal;

      if (!stored.equals(computed)) {
        mismatches.push(`${field}: saklanan ${stored.toString()}, beklenen ${computed.toString()}`);
      }
    };

    compare('subtotal');
    compare('discountTotal');
    compare('grandTotal');
    compare('paidTotal');
    compare('remainingTotal');
    compare('costTotal');
    compare('additionalCostTotal');
    compare('grossProfit');
    compare('netProfit');

    const expectedStatus = this.resolveStatus(sale.status, expected);

    if (sale.status !== expectedStatus) {
      mismatches.push(`status: saklanan ${sale.status}, beklenen ${expectedStatus}`);
    }

    return { isConsistent: mismatches.length === 0, mismatches };
  }

  /** Para değerini 4 ondalık basamağa sabitler. */
  private money(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(SaleCalculationService.MONEY_SCALE);
  }

  private decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  }

  /**
   * KDV DAHİL bir tutardan vergi payını ayrıştırır (ters hesap).
   *
   *   vergi = tutar * oran / (100 + oran)
   *
   * Oran sıfır veya negatifse vergi yoktur — "KDV değeri girilmezse hariç"
   * kuralının kod karşılığı. Negatif oran da sıfır sayılır: geçersiz veri
   * sessizce negatif vergi üretmesin.
   */
  private extractTax(amount: Prisma.Decimal, taxRate: Prisma.Decimal): Prisma.Decimal {
    if (taxRate.lessThanOrEqualTo(0)) {
      return new Prisma.Decimal(0);
    }

    return amount.times(taxRate).dividedBy(taxRate.plus(100));
  }
}

export interface SaleItemInput {
  quantity: Prisma.Decimal | string;
  unitSalePrice: Prisma.Decimal | string;
  unitPurchasePrice: Prisma.Decimal | string;
  discountAmount?: Prisma.Decimal | string;
  /** Yüzde. Verilmezse veya 0 ise kalem KDV'siz sayılır. */
  taxRate?: Prisma.Decimal | string;
}

export interface CalculatedSaleItem {
  quantity: Prisma.Decimal;
  unitSalePrice: Prisma.Decimal;
  unitPurchasePrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineCost: Prisma.Decimal;
  /** Satır tutarının içinden ayrıştırılan KDV. */
  lineTax: Prisma.Decimal;
  lineProfit: Prisma.Decimal;
}

export interface TotalsInput {
  items: {
    lineSubtotal: Prisma.Decimal | string;
    lineTotal: Prisma.Decimal | string;
    lineCost: Prisma.Decimal | string;
    discountAmount: Prisma.Decimal | string;
    /** Satırdan ayrışan KDV. Oranı 0 olan kalemde sıfırdır. */
    lineTax: Prisma.Decimal | string;
    /** Satır kârı — NET tutarlar üzerinden. */
    lineProfit: Prisma.Decimal | string;
  }[];
  additionalCosts: { amount: Prisma.Decimal | string }[];
  paidTotal: Prisma.Decimal | string;
}

export interface SaleTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  paidTotal: Prisma.Decimal;
  remainingTotal: Prisma.Decimal;
  costTotal: Prisma.Decimal;
  additionalCostTotal: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  netProfit: Prisma.Decimal;
  status: SaleStatus;
}

export interface ConsistencyReport {
  isConsistent: boolean;
  mismatches: string[];
}
