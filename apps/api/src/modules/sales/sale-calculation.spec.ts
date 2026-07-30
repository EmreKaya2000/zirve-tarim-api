import { Prisma, SaleStatus } from '@prisma/client';

import { SaleCalculationService } from './sale-calculation.service';

/**
 * Satış hesaplama birim testleri.
 *
 * SPRINTİN EN KRİTİK TESTLERİ. Kâr hesabındaki bir hata, aylar sonra
 * yanlış bir vergi beyanı veya yanlış bir fiyat kararı olarak geri döner
 * ve kaynağı bulunamaz.
 *
 * Tüm beklenen değerler ELLE hesaplanmıştır; koddan türetilmemiştir.
 * Aksi hâlde test, kodun kendi hatasını onaylar.
 */
describe('SaleCalculationService', () => {
  const service = new SaleCalculationService();

  const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

  describe('kalem hesabı', () => {
    it('indirimsiz kalem', () => {
      // 10 x 395 = 3950 | maliyet 10 x 285 = 2850 | kâr 1100
      const result = service.calculateItem({
        quantity: '10',
        unitSalePrice: '395',
        unitPurchasePrice: '285',
      });

      expect(result.lineSubtotal.toString()).toBe('3950');
      expect(result.lineTotal.toString()).toBe('3950');
      expect(result.lineCost.toString()).toBe('2850');
      expect(result.lineProfit.toString()).toBe('1100');
    });

    it('indirimli kalem — indirim kârdan düşer', () => {
      // 5 x 395 = 1975 - 100 = 1875 | maliyet 1425 | kâr 450
      const result = service.calculateItem({
        quantity: '5',
        unitSalePrice: '395',
        unitPurchasePrice: '285',
        discountAmount: '100',
      });

      expect(result.lineSubtotal.toString()).toBe('1975');
      expect(result.lineTotal.toString()).toBe('1875');
      expect(result.lineCost.toString()).toBe('1425');
      expect(result.lineProfit.toString()).toBe('450');
    });

    it('ondalık miktarda kuruş kaybı olmaz', () => {
      // 2.5 x 33.33 = 83.325 -> 83.325 (4 basamak korunur)
      const result = service.calculateItem({
        quantity: '2.5',
        unitSalePrice: '33.33',
        unitPurchasePrice: '20.10',
      });

      expect(result.lineSubtotal.toString()).toBe('83.325');
      expect(result.lineCost.toString()).toBe('50.25');
      expect(result.lineProfit.toString()).toBe('33.075');
    });

    it('float ile yapılsa hatalı çıkacak hesap doğru sonuç verir', () => {
      // JS: 0.1 * 3 = 0.30000000000000004
      const result = service.calculateItem({
        quantity: '3',
        unitSalePrice: '0.1',
        unitPurchasePrice: '0',
      });

      expect(result.lineSubtotal.toString()).toBe('0.3');
      expect(result.lineProfit.toString()).toBe('0.3');
    });

    it('zararına satışta kâr NEGATİF kalır, sıfıra kırpılmaz', () => {
      // Elde kalan malı maliyetin altında çıkarmak gerçek bir iş kararıdır.
      const result = service.calculateItem({
        quantity: '10',
        unitSalePrice: '200',
        unitPurchasePrice: '285',
      });

      expect(result.lineProfit.toString()).toBe('-850');
      expect(result.lineProfit.isNegative()).toBe(true);
    });

    it('indirim satır tutarına eşitse kâr = -maliyet olur', () => {
      const result = service.calculateItem({
        quantity: '2',
        unitSalePrice: '100',
        unitPurchasePrice: '60',
        discountAmount: '200',
      });

      expect(result.lineTotal.toString()).toBe('0');
      expect(result.lineProfit.toString()).toBe('-120');
    });
  });

  /**
   * KDV KURALI (2026-07-30 kararı, şartname §9.1):
   *   oran > 0  -> satış fiyatı KDV DAHİLDİR, vergi ters hesapla ayrıştırılır
   *   oran = 0  -> kalem KDV'sizdir
   *
   * En kritik test "kâr NET tutar üzerinden" olanıdır: ham `lineTotal -
   * lineCost` kullanılsaydı %20 oranda kâr TAM %20 fazla görünürdü ve finans
   * modülünün asıl çıktısı yanlış olurdu.
   */
  describe('KDV — girilirse dahil, girilmezse hariç', () => {
    it('oran girilmezse KDV yoktur ve kâr ham farktır', () => {
      const result = service.calculateItem({
        quantity: '10',
        unitSalePrice: '395',
        unitPurchasePrice: '285',
      });

      expect(result.taxRate.toString()).toBe('0');
      expect(result.lineTax.toString()).toBe('0');
      expect(result.lineProfit.toString()).toBe('1100');
    });

    it('oran 0 açıkça verilse de KDV yoktur', () => {
      const result = service.calculateItem({
        quantity: '1',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        taxRate: '0',
      });

      expect(result.lineTax.toString()).toBe('0');
      expect(result.lineProfit.toString()).toBe('60');
    });

    it('oran verilirse fiyat KDV DAHİL sayılır ve vergi ters hesapla ayrışır', () => {
      // 120 TL, %20 dahil -> 120 * 20 / 120 = 20 TL vergi, 100 TL net
      const result = service.calculateItem({
        quantity: '1',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        taxRate: '20',
      });

      expect(result.lineTotal.toString()).toBe('120');
      expect(result.lineTax.toString()).toBe('20');
    });

    it('KÂR NET TUTAR ÜZERİNDEN hesaplanır', () => {
      // Satış 120 (net 100), alış 60 (net 50) -> net kâr 50.
      // Ham fark 60 olurdu: %20 oranda kâr tam %20 şişerdi.
      const result = service.calculateItem({
        quantity: '1',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        taxRate: '20',
      });

      expect(result.lineProfit.toString()).toBe('50');
      expect(result.lineProfit.toString()).not.toBe('60');
    });

    it('KDV oranı MÜŞTERİNİN ÖDEDİĞİ tutarı değiştirmez', () => {
      const withTax = service.calculateItem({
        quantity: '3',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        taxRate: '20',
      });
      const withoutTax = service.calculateItem({
        quantity: '3',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
      });

      expect(withTax.lineTotal.toString()).toBe(withoutTax.lineTotal.toString());
      expect(withTax.lineSubtotal.toString()).toBe(withoutTax.lineSubtotal.toString());
    });

    it('indirim KDV ayrıştırmasından ÖNCE düşer', () => {
      // 240 - 40 = 200 üzerinden %20 -> 200 * 20 / 120 = 33.3333
      const result = service.calculateItem({
        quantity: '2',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        discountAmount: '40',
        taxRate: '20',
      });

      expect(result.lineTotal.toString()).toBe('200');
      expect(result.lineTax.toString()).toBe('33.3333');
    });

    it('negatif oran sıfır sayılır — geçersiz veri negatif vergi üretmez', () => {
      const result = service.calculateItem({
        quantity: '1',
        unitSalePrice: '120',
        unitPurchasePrice: '60',
        taxRate: '-20',
      });

      expect(result.lineTax.toString()).toBe('0');
    });

    it('ondalık oranda kuruş kaybı olmaz', () => {
      // %1 dahil: 101 * 1 / 101 = 1
      const result = service.calculateItem({
        quantity: '1',
        unitSalePrice: '101',
        unitPurchasePrice: '50',
        taxRate: '1',
      });

      expect(result.lineTax.toString()).toBe('1');
    });
  });

  describe('satış toplamları', () => {
    /** İki kalemli, biri indirimli satış — canlı doğrulanan senaryo. */
    // `lineProfit` ve `lineTax` DAHİL EDİLİR: gerçek satış kalemlerinde ikisi de
    // NOT NULL kolondur ve `computeTotals` onları toplar. Fixture'da eksik
    // bırakmak, testin üretimde olmayan bir durumu doğrulaması olurdu.
    const items = [
      {
        lineSubtotal: '3950',
        lineTotal: '3950',
        lineCost: '2850',
        discountAmount: '0',
        lineTax: '0',
        lineProfit: '1100',
      },
      {
        lineSubtotal: '1975',
        lineTotal: '1875',
        lineCost: '1425',
        discountAmount: '100',
        lineTax: '0',
        lineProfit: '450',
      },
    ];

    it('çok kalemli satışta tüm toplamlar doğru', () => {
      const totals = service.computeTotals({ items, additionalCosts: [], paidTotal: '0' });

      expect(totals.subtotal.toString()).toBe('5925');
      expect(totals.discountTotal.toString()).toBe('100');
      expect(totals.grandTotal.toString()).toBe('5825');
      expect(totals.costTotal.toString()).toBe('4275');
      expect(totals.grossProfit.toString()).toBe('1550');
      expect(totals.netProfit.toString()).toBe('1550');
      expect(totals.remainingTotal.toString()).toBe('5825');
    });

    it('KDV oranı girilmemiş kalemlerde taxTotal sıfırdır', () => {
      const totals = service.computeTotals({ items, additionalCosts: [], paidTotal: '0' });

      expect(totals.taxTotal.toString()).toBe('0');
    });

    it('taxTotal kalemlerden ayrışan KDV paylarının toplamıdır', () => {
      const totals = service.computeTotals({
        items: [
          { ...(items[0] as object), lineTax: '658.3333' },
          { ...(items[1] as object), lineTax: '312.5' },
        ] as typeof items,
        additionalCosts: [],
        paidTotal: '0',
      });

      expect(totals.taxTotal.toString()).toBe('970.8333');
    });

    it('taxTotal grandTotal a EKLENMEZ — fiyat KDV dahil', () => {
      const withTax = service.computeTotals({
        items: [{ ...(items[0] as object), lineTax: '658.3333' }] as typeof items,
        additionalCosts: [],
        paidTotal: '0',
      });
      const withoutTax = service.computeTotals({
        items: [items[0] as (typeof items)[number]],
        additionalCosts: [],
        paidTotal: '0',
      });

      // Müşterinin ödediği tutar KDV oranından ETKİLENMEZ; vergi zaten
      // fiyatın içindedir. Eklenseydi vergi iki kez alınmış olurdu.
      expect(withTax.grandTotal.toString()).toBe(withoutTax.grandTotal.toString());
    });

    it('netProfit = grossProfit - ek maliyetler', () => {
      const totals = service.computeTotals({
        items,
        additionalCosts: [{ amount: '250' }, { amount: '150' }],
        paidTotal: '0',
      });

      expect(totals.additionalCostTotal.toString()).toBe('400');
      expect(totals.grossProfit.toString()).toBe('1550');
      expect(totals.netProfit.toString()).toBe('1150');
    });

    it('ek maliyet brüt kârı aşarsa netProfit negatif olur', () => {
      const totals = service.computeTotals({
        items,
        additionalCosts: [{ amount: '2000' }],
        paidTotal: '0',
      });

      expect(totals.netProfit.toString()).toBe('-450');
    });

    it('kalan borç = genel toplam - ödenen', () => {
      const totals = service.computeTotals({ items, additionalCosts: [], paidTotal: '2000' });

      expect(totals.paidTotal.toString()).toBe('2000');
      expect(totals.remainingTotal.toString()).toBe('3825');
    });

    it('kalemsiz satışta tüm toplamlar sıfır', () => {
      const totals = service.computeTotals({ items: [], additionalCosts: [], paidTotal: '0' });

      expect(totals.grandTotal.toString()).toBe('0');
      expect(totals.grossProfit.toString()).toBe('0');
      expect(totals.netProfit.toString()).toBe('0');
    });

    it("ek maliyet grandTotal'ı ETKİLEMEZ — yalnız kârı düşürür", () => {
      // Nakliye masrafı müşteriye yansıtılmıyorsa borcu artırmaz.
      const withCost = service.computeTotals({
        items,
        additionalCosts: [{ amount: '500' }],
        paidTotal: '0',
      });
      const without = service.computeTotals({ items, additionalCosts: [], paidTotal: '0' });

      expect(withCost.grandTotal.toString()).toBe(without.grandTotal.toString());
      expect(withCost.netProfit.lessThan(without.netProfit)).toBe(true);
    });
  });

  describe('durum çözümlemesi', () => {
    it('taslak satışın durumu ödemeyle DEĞİŞMEZ', () => {
      const status = service.resolveStatus(SaleStatus.DRAFT, {
        grandTotal: d('1000'),
        paidTotal: d('1000'),
      });

      expect(status).toBe(SaleStatus.DRAFT);
    });

    it('iptal edilmiş satışın durumu ödemeyle GERİ DÖNMEZ', () => {
      const status = service.resolveStatus(SaleStatus.CANCELLED, {
        grandTotal: d('1000'),
        paidTotal: d('1000'),
      });

      expect(status).toBe(SaleStatus.CANCELLED);
    });

    it('ödeme yoksa CONFIRMED', () => {
      expect(
        service.resolveStatus(SaleStatus.CONFIRMED, { grandTotal: d('1000'), paidTotal: d('0') }),
      ).toBe(SaleStatus.CONFIRMED);
    });

    it('kısmi ödemede PARTIALLY_PAID', () => {
      expect(
        service.resolveStatus(SaleStatus.CONFIRMED, { grandTotal: d('1000'), paidTotal: d('400') }),
      ).toBe(SaleStatus.PARTIALLY_PAID);
    });

    it('tamamı ödendiğinde PAID', () => {
      expect(
        service.resolveStatus(SaleStatus.CONFIRMED, {
          grandTotal: d('1000'),
          paidTotal: d('1000'),
        }),
      ).toBe(SaleStatus.PAID);
    });

    it('ödeme silinince PAID durumundan geri döner', () => {
      // Yanlış girilmiş tahsilat silindiğinde borç yeniden doğar.
      expect(
        service.resolveStatus(SaleStatus.PAID, { grandTotal: d('1000'), paidTotal: d('400') }),
      ).toBe(SaleStatus.PARTIALLY_PAID);

      expect(
        service.resolveStatus(SaleStatus.PAID, { grandTotal: d('1000'), paidTotal: d('0') }),
      ).toBe(SaleStatus.CONFIRMED);
    });

    it('sıfır tutarlı satış onaylandığında PAID sayılır', () => {
      // Tamamı indirimli satışta tahsil edilecek bir şey yok.
      expect(
        service.resolveStatus(SaleStatus.CONFIRMED, { grandTotal: d('0'), paidTotal: d('0') }),
      ).toBe(SaleStatus.CONFIRMED);
    });
  });
});
