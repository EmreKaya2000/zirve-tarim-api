import { Prisma } from '@prisma/client';

import {
  checkQuantity,
  quantityViolationMessage,
  resolveNearestValidQuantity,
  toQuantityDecimal,
  trimQuantity,
  type QuantityRuleSet,
} from './quantity-rules';

/**
 * Miktar kuralları, Sprint 6'dan beri talep gönderiminin ve Sprint 11'den beri
 * sepet birleştirmesinin ortak temeli. İki farklı politika (reddetme /
 * en yakın geçerli değere ayarlama) aynı kuralı kullandığı için bu testler
 * ikisini birden korur.
 *
 * ONDALIK KIYASLAMANIN FLOAT'LA YAPILMADIĞI ayrıca sınanır: `(2.5 - 0.5) % 0.5`
 * JS float'ta 0 yerine 0.49999...'a düşer ve geçerli bir miktar reddedilirdi.
 */
describe('quantity-rules', () => {
  const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

  /** 5 kg'lık çuval: en az 5, 5'in katları, en fazla 100. */
  const sackRules: QuantityRuleSet = {
    minOrderQuantity: '5',
    quantityStep: '5',
    maxOrderQuantity: '100',
    allowsDecimal: true,
  };

  /** Adet birimi: ondalık kabul etmez, adım 1, üst sınır yok. */
  const pieceRules: QuantityRuleSet = {
    minOrderQuantity: '1',
    quantityStep: '1',
    maxOrderQuantity: null,
    allowsDecimal: false,
  };

  /** Dökme kg: 0.5 adımlı, asgari 2.5 — ondalık ızgara. */
  const bulkRules: QuantityRuleSet = {
    minOrderQuantity: '2.5',
    quantityStep: '0.5',
    maxOrderQuantity: '10',
    allowsDecimal: true,
  };

  describe('checkQuantity', () => {
    it('ızgaraya oturan miktarı kabul eder', () => {
      expect(checkQuantity(d('5'), sackRules)).toBeNull();
      expect(checkQuantity(d('50'), sackRules)).toBeNull();
      expect(checkQuantity(d('100'), sackRules)).toBeNull();
    });

    it('sıfır ve negatif miktarı reddeder', () => {
      expect(checkQuantity(d('0'), sackRules)).toEqual({ kind: 'not-positive' });
      expect(checkQuantity(d('-5'), sackRules)).toEqual({ kind: 'not-positive' });
    });

    it('ondalık kabul etmeyen birimde ondalığı reddeder', () => {
      expect(checkQuantity(d('2.5'), pieceRules)).toEqual({ kind: 'not-integer' });
    });

    it('ondalık kontrolü asgari kontrolünden ÖNCE gelir', () => {
      // "0.5 adet" girildiğinde asıl sorun ondalık olmasıdır; kullanıcıya
      // "en az 1 adet" demek onu 0.5'i düzeltmeye yöneltmez.
      expect(checkQuantity(d('0.5'), pieceRules)).toEqual({ kind: 'not-integer' });
    });

    it('asgarinin altını reddeder', () => {
      expect(checkQuantity(d('3'), sackRules)).toMatchObject({ kind: 'below-min' });
    });

    it('azaminin üstünü reddeder', () => {
      expect(checkQuantity(d('105'), sackRules)).toMatchObject({ kind: 'above-max' });
    });

    it('azami tanımsızsa üst sınır uygulanmaz', () => {
      expect(checkQuantity(d('999999'), pieceRules)).toBeNull();
    });

    it('adım ızgarasına oturmayan miktarı reddeder', () => {
      expect(checkQuantity(d('7'), sackRules)).toMatchObject({ kind: 'off-step' });
    });

    it('ızgara ASGARİYE çapalıdır, sıfıra değil', () => {
      const rules: QuantityRuleSet = {
        minOrderQuantity: '3',
        quantityStep: '5',
        maxOrderQuantity: null,
        allowsDecimal: true,
      };

      // 3, 8, 13... geçerli. 5, sıfıra çapalı bir ızgarada geçerli görünürdü.
      expect(checkQuantity(d('3'), rules)).toBeNull();
      expect(checkQuantity(d('8'), rules)).toBeNull();
      expect(checkQuantity(d('5'), rules)).toMatchObject({ kind: 'off-step' });
    });

    it('ondalık ızgarayı float hatası olmadan doğrular', () => {
      // Float ile (2.5 - 2.5) % 0.5 sorunsuzdur ama 3.0, 4.5 ve 7.5 gibi
      // değerlerde `%` operatörü 0 yerine 0.4999...'a düşebilir.
      expect(checkQuantity(d('2.5'), bulkRules)).toBeNull();
      expect(checkQuantity(d('3'), bulkRules)).toBeNull();
      expect(checkQuantity(d('4.5'), bulkRules)).toBeNull();
      expect(checkQuantity(d('7.5'), bulkRules)).toBeNull();
      expect(checkQuantity(d('2.7'), bulkRules)).toMatchObject({ kind: 'off-step' });
    });

    it('adım 0 ise ızgara uygulanmaz', () => {
      const rules: QuantityRuleSet = {
        minOrderQuantity: '1',
        quantityStep: '0',
        maxOrderQuantity: '10',
        allowsDecimal: true,
      };

      expect(checkQuantity(d('3.7'), rules)).toBeNull();
    });
  });

  describe('resolveNearestValidQuantity', () => {
    it('geçerli miktarı olduğu gibi bırakır', () => {
      expect(resolveNearestValidQuantity(d('50'), sackRules)?.toString()).toBe('50');
    });

    it('ızgara dışı miktarı EN YAKIN geçerli değere çeker', () => {
      // 5 + 3 = 8 -> ızgara 5, 10, 15... En yakın 10.
      expect(resolveNearestValidQuantity(d('8'), sackRules)?.toString()).toBe('10');
      // 12 -> 10'a daha yakın.
      expect(resolveNearestValidQuantity(d('12'), sackRules)?.toString()).toBe('10');
      // 13 -> 15'e daha yakın.
      expect(resolveNearestValidQuantity(d('13'), sackRules)?.toString()).toBe('15');
    });

    it('asgarinin altını YUKARI, asgariye çeker', () => {
      // Aşağı yuvarlanırsa 0 çıkar ve kalem sepetten düşerdi; kullanıcı
      // ürünü kaybetmiş olurdu.
      expect(resolveNearestValidQuantity(d('1'), sackRules)?.toString()).toBe('5');
      expect(resolveNearestValidQuantity(d('0.1'), sackRules)?.toString()).toBe('5');
    });

    it('azamiyi AŞMAYAN en büyük ızgara noktasına iner', () => {
      const rules: QuantityRuleSet = {
        minOrderQuantity: '5',
        quantityStep: '5',
        maxOrderQuantity: '98',
        allowsDecimal: true,
      };

      // Yukarı yuvarlama 100 üretirdi; 100 > 98 olduğu için o da geçersizdir.
      expect(resolveNearestValidQuantity(d('150'), rules)?.toString()).toBe('95');
    });

    it('azami tam ızgara noktasıysa ona oturur', () => {
      expect(resolveNearestValidQuantity(d('500'), sackRules)?.toString()).toBe('100');
    });

    it('adet biriminde ondalığı tam sayıya çeker', () => {
      expect(resolveNearestValidQuantity(d('2.4'), pieceRules)?.toString()).toBe('2');
      expect(resolveNearestValidQuantity(d('2.6'), pieceRules)?.toString()).toBe('3');
    });

    it('ondalık ızgaraya oturtur', () => {
      expect(resolveNearestValidQuantity(d('3.3'), bulkRules)?.toString()).toBe('3.5');
      expect(resolveNearestValidQuantity(d('3.1'), bulkRules)?.toString()).toBe('3');
    });

    it('adım 0 ise yalnız aralığa sıkıştırır', () => {
      const rules: QuantityRuleSet = {
        minOrderQuantity: '2',
        quantityStep: '0',
        maxOrderQuantity: '10',
        allowsDecimal: true,
      };

      expect(resolveNearestValidQuantity(d('3.7'), rules)?.toString()).toBe('3.7');
      expect(resolveNearestValidQuantity(d('99'), rules)?.toString()).toBe('10');
      expect(resolveNearestValidQuantity(d('1'), rules)?.toString()).toBe('2');
    });

    it('aralık boşsa (min > max) null döner', () => {
      // Tutarsız varyasyon yapılandırması. Miktar uydurmak yerine kalem
      // atlanır ve yöneticinin düzeltmesi beklenir.
      const broken: QuantityRuleSet = {
        minOrderQuantity: '10',
        quantityStep: '1',
        maxOrderQuantity: '5',
        allowsDecimal: true,
      };

      expect(resolveNearestValidQuantity(d('7'), broken)).toBeNull();
    });

    it('adet biriminde ondalık ızgara tanımlıysa null döner', () => {
      // Hiçbir tam sayı bu ızgaraya oturmaz: 1, 1.5, 2, 2.5... değil —
      // asgari 1.5 olduğu için 1.5, 2.0, 2.5 çıkar ve 2.0 tam sayı olsa da
      // aşağıdaki istek 1.7 -> 1.5'e oturur ve tam sayı olmadığı için düşer.
      const broken: QuantityRuleSet = {
        minOrderQuantity: '1.5',
        quantityStep: '0.5',
        maxOrderQuantity: null,
        allowsDecimal: false,
      };

      expect(resolveNearestValidQuantity(d('1.6'), broken)).toBeNull();
    });

    it('sonuç DAİMA checkQuantity ı geçer', () => {
      // Çözümleyicinin son sözü doğrulayıcıya bırakması bu güvenceyi verir:
      // hiçbir durumda "ayarlandı" denip geçersiz bir miktar yazılamaz.
      const rulesets = [sackRules, pieceRules, bulkRules];
      const requests = ['0.001', '1', '3', '7', '12.4', '99', '1000'];

      for (const rules of rulesets) {
        for (const request of requests) {
          const resolved = resolveNearestValidQuantity(d(request), rules);

          if (resolved !== null) {
            expect(checkQuantity(resolved, rules)).toBeNull();
          }
        }
      }
    });
  });

  describe('quantityViolationMessage', () => {
    it('Sprint 6 metinlerini korur', () => {
      // e2e testleri ve arayüz bu ifadelere dayanıyor.
      expect(quantityViolationMessage({ kind: 'not-integer' }, 'ad')).toContain('ondalık');
      expect(quantityViolationMessage({ kind: 'below-min', min: d('5') }, 'kg')).toContain('En az');
      expect(quantityViolationMessage({ kind: 'above-max', max: d('100') }, 'kg')).toContain(
        'En fazla',
      );
      expect(
        quantityViolationMessage({ kind: 'off-step', min: d('5'), step: d('5') }, 'kg'),
      ).toContain('adımlarla');
    });
  });

  describe('yardımcılar', () => {
    it('trimQuantity gereksiz sıfırları atar', () => {
      expect(trimQuantity('5.000')).toBe('5');
      expect(trimQuantity('2.500')).toBe('2.5');
      expect(trimQuantity('0.125')).toBe('0.125');
    });

    it('toQuantityDecimal geçersiz metinde null döner', () => {
      expect(toQuantityDecimal('abc')).toBeNull();
      expect(toQuantityDecimal('')).toBeNull();
      expect(toQuantityDecimal('NaN')).toBeNull();
      expect(toQuantityDecimal('Infinity')).toBeNull();
      expect(toQuantityDecimal('12.5')?.toString()).toBe('12.5');
    });
  });
});
