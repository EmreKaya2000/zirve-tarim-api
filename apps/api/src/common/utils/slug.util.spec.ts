import { appendSlugSuffix, slugify } from './slug.util';

describe('slugify', () => {
  describe('Türkçe karakter dönüşümü', () => {
    // Bu testler kritik: JavaScript'in yerleşik aksan ayıklaması (NFD)
    // Türkçe'de yanlış çalışır. "ı" ve "i" AYRI harflerdir.
    it.each([
      ['çğıöşü', 'cgiosu'],
      ['ÇĞIİÖŞÜ', 'cgiiosu'],
      ['Sıvı Gübre', 'sivi-gubre'],
      ['Çiçeklenme Öncesi', 'ciceklenme-oncesi'],
      ['Yaprak Gübresi', 'yaprak-gubresi'],
      ['Toprak Düzenleyici', 'toprak-duzenleyici'],
      ['Buğday', 'bugday'],
      ['Şeftali', 'seftali'],
      ['Işıklı Sera', 'isikli-sera'],
      ['İzmir Üzümü', 'izmir-uzumu'],
    ])('%s -> %s', (input, expected) => {
      expect(slugify(input)).toBe(expected);
    });

    it('büyük I harfini i ye çevirir (Türkçe kuralı)', () => {
      // Türkçe'de "I"nın küçüğü "ı"dır; slug'da ikisi de "i" olur.
      expect(slugify('IŞIK')).toBe('isik');
      expect(slugify('ışık')).toBe('isik');
    });
  });

  describe('genel biçimlendirme', () => {
    it('boşlukları tire yapar', () => {
      expect(slugify('katı gübre')).toBe('kati-gubre');
    });

    it('ardışık boşluk ve noktalamayı tek tireye indirger', () => {
      expect(slugify('NPK   20 - 20 - 20')).toBe('npk-20-20-20');
      expect(slugify('Gübre / Sıvı')).toBe('gubre-sivi');
    });

    it('baş ve sondaki tireleri atar', () => {
      expect(slugify('  --Gübre--  ')).toBe('gubre');
    });

    it('rakamları korur', () => {
      expect(slugify('15-15-15 Kompoze')).toBe('15-15-15-kompoze');
    });

    it('emoji ve özel karakterleri atar', () => {
      expect(slugify('Gübre 🌱 Özel!')).toBe('gubre-ozel');
    });

    it('yalnız özel karakterden oluşan girdide boş döner', () => {
      expect(slugify('!!!')).toBe('');
    });

    it('boş girdide boş döner', () => {
      expect(slugify('')).toBe('');
    });

    it('diğer dillerin aksanlarını da ayıklar', () => {
      expect(slugify('Café Ñandú')).toBe('cafe-nandu');
    });
  });

  describe('uzunluk sınırı', () => {
    it('azami uzunluğu aşmaz', () => {
      const result = slugify('a'.repeat(200));

      expect(result).toHaveLength(150);
    });

    it('kesme sonrası sonda tire bırakmaz', () => {
      // "uzun-bir-metin" 9. karakterde kesilince "uzun-bir-" olur;
      // sondaki tire atılmalı.
      expect(slugify('uzun bir metin', 9)).toBe('uzun-bir');
    });

    it('kesme tam kelime ortasına denk gelirse olduğu gibi bırakır', () => {
      // Kelime bütünlüğü korunmaya ÇALIŞILMAZ: slug'ın öngörülebilir
      // uzunlukta olması daha önemlidir.
      expect(slugify('uzun bir metin', 10)).toBe('uzun-bir-m');
    });

    it('özel azami uzunluğa uyar', () => {
      expect(slugify('gubre cesitleri', 8)).toBe('gubre-ce');
    });
  });
});

describe('appendSlugSuffix', () => {
  it('sayısal sonek ekler', () => {
    expect(appendSlugSuffix('sivi-gubre', 2)).toBe('sivi-gubre-2');
  });

  it('çok basamaklı soneki destekler', () => {
    expect(appendSlugSuffix('gubre', 123)).toBe('gubre-123');
  });

  it('azami uzunluğu aşmamak için tabanı kısaltır', () => {
    const result = appendSlugSuffix('a'.repeat(150), 5, 150);

    expect(result).toHaveLength(150);
    expect(result.endsWith('-5')).toBe(true);
  });

  it('kısaltma sonrası çift tire bırakmaz', () => {
    expect(appendSlugSuffix('uzun-slug-', 3, 11)).toBe('uzun-slug-3');
  });
});
