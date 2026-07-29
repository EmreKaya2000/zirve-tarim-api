import { parseDuration } from './token.service';

describe('parseDuration', () => {
  it('saniye birimini çözer', () => {
    expect(parseDuration('30s')).toBe(30);
  });

  it('dakika birimini çözer', () => {
    expect(parseDuration('15m')).toBe(900);
  });

  it('saat birimini çözer', () => {
    expect(parseDuration('12h')).toBe(43_200);
  });

  it('gün birimini çözer', () => {
    expect(parseDuration('7d')).toBe(604_800);
  });

  it('birimsiz değeri saniye kabul eder', () => {
    expect(parseDuration('120')).toBe(120);
  });

  it('büyük harf birimi kabul eder', () => {
    expect(parseDuration('15M')).toBe(900);
  });

  it('baştaki/sondaki boşluğu yok sayar', () => {
    expect(parseDuration('  7d  ')).toBe(604_800);
  });

  it('geçersiz biçimi reddeder', () => {
    expect(() => parseDuration('yarım saat')).toThrow(/Geçersiz süre biçimi/);
    expect(() => parseDuration('15x')).toThrow(/Geçersiz süre biçimi/);
    expect(() => parseDuration('')).toThrow(/Geçersiz süre biçimi/);
  });
});
