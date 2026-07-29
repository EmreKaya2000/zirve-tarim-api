import {
  ALLOWED_INQUIRY_TRANSITIONS,
  INQUIRY_STATUSES,
  SALE_CONVERSION_STATUS,
  TERMINAL_INQUIRY_STATUSES,
  canTransitionInquiry,
  isTerminalInquiryStatus,
  nextInquiryStatuses,
  type InquiryStatus,
} from '@zirve/types';

import { format } from '../../common/services/number-sequence.service';
import { normalizePhone } from '../../common/utils/phone';
import { CREATE_THROTTLE, VALIDATE_THROTTLE } from './public-inquiries.controller';

/**
 * Talep durum makinesi ve yardımcıları — birim testleri.
 *
 * Durum tablosu backend ile arayüz arasında PAYLAŞILDIĞI için burada
 * doğrulanması iki tarafı birden korur.
 */
describe('Talep durum makinesi', () => {
  it('her durum için geçiş tanımı bulunur', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(ALLOWED_INQUIRY_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('uç durumlardan çıkış yoktur', () => {
    for (const status of TERMINAL_INQUIRY_STATUSES) {
      expect(ALLOWED_INQUIRY_TRANSITIONS[status]).toHaveLength(0);
      expect(isTerminalInquiryStatus(status)).toBe(true);
    }
  });

  it('ARCHITECTURE §10.1 ana akışı geçerlidir', () => {
    const flow: InquiryStatus[] = [
      'NEW',
      'REVIEWING',
      'CONTACTED',
      'QUOTED',
      'APPROVED',
      'CONVERTED_TO_SALE',
    ];

    for (let index = 0; index < flow.length - 1; index += 1) {
      const from = flow[index] as InquiryStatus;
      const to = flow[index + 1] as InquiryStatus;

      expect(canTransitionInquiry(from, to)).toBe(true);
    }
  });

  it('adım atlamaya izin verilmez', () => {
    expect(canTransitionInquiry('NEW', 'QUOTED')).toBe(false);
    expect(canTransitionInquiry('NEW', 'APPROVED')).toBe(false);
    expect(canTransitionInquiry('REVIEWING', 'APPROVED')).toBe(false);
  });

  it('iptal, REVIEWING sonrası her aktif adımdan mümkündür', () => {
    // Müşteri her aşamada vazgeçebilir.
    for (const status of ['NEW', 'REVIEWING', 'CONTACTED', 'QUOTED', 'APPROVED'] as const) {
      expect(canTransitionInquiry(status, 'CANCELLED')).toBe(true);
    }
  });

  it('red yalnız erken adımlardan mümkündür', () => {
    // Teklif verildikten sonra "spam" demek tutarsız olur.
    expect(canTransitionInquiry('NEW', 'REJECTED')).toBe(true);
    expect(canTransitionInquiry('REVIEWING', 'REJECTED')).toBe(true);
    expect(canTransitionInquiry('QUOTED', 'REJECTED')).toBe(false);
    expect(canTransitionInquiry('APPROVED', 'REJECTED')).toBe(false);
  });

  it('satışa dönüşüm yalnız APPROVED sonrası mümkündür', () => {
    const sources = INQUIRY_STATUSES.filter((status) =>
      canTransitionInquiry(status, SALE_CONVERSION_STATUS),
    );

    expect(sources).toEqual(['APPROVED']);
  });

  it('hiçbir durum kendisine geçemez', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(canTransitionInquiry(status, status)).toBe(false);
    }
  });

  it('nextInquiryStatuses tabloyla aynı sonucu verir', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(nextInquiryStatuses(status)).toBe(ALLOWED_INQUIRY_TRANSITIONS[status]);
    }
  });

  it('ulaşılamayan durum yoktur', () => {
    // NEW dışındaki her durumun en az bir girişi olmalı; olmayan bir durum
    // enum'da durup asla kullanılamaz — sessiz bir tasarım hatası.
    for (const status of INQUIRY_STATUSES) {
      if (status === 'NEW') {
        continue;
      }

      const reachable = INQUIRY_STATUSES.some((from) => canTransitionInquiry(from, status));

      expect(reachable).toBe(true);
    }
  });
});

describe('Belge numarası biçimi', () => {
  it('TLP-YYYY-NNNNNN biçiminde üretir', () => {
    expect(format('TLP', 2026, 1)).toBe('TLP-2026-000001');
    expect(format('TLP', 2026, 42)).toBe('TLP-2026-000042');
    expect(format('TLP', 2026, 999_999)).toBe('TLP-2026-999999');
  });

  it('altı basamağı aşan değerde kısaltma YAPMAZ', () => {
    // Numara kaybetmek, biçim bozulmasından çok daha kötüdür.
    expect(format('TLP', 2026, 1_000_000)).toBe('TLP-2026-1000000');
  });

  it('ön eki büyük harfe çevirir', () => {
    expect(format('tlp', 2026, 1)).toBe('TLP-2026-000001');
  });

  it('veritabanı kısıtıyla uyumlu biçim üretir', () => {
    // migration.sql -> chk_inquiries_number_format
    const pattern = /^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$/;

    expect(pattern.test(format('TLP', 2026, 1))).toBe(true);
    expect(pattern.test(format('SAT', 2027, 12_345))).toBe(true);
  });
});

describe('Telefon normalleştirme', () => {
  it('farklı yazımları aynı 10 haneli biçime indirir', () => {
    const expected = '5321234567';

    expect(normalizePhone('05321234567')).toBe(expected);
    expect(normalizePhone('0532 123 45 67')).toBe(expected);
    expect(normalizePhone('+90 532 123 45 67')).toBe(expected);
    expect(normalizePhone('905321234567')).toBe(expected);
    expect(normalizePhone('532-123-45-67')).toBe(expected);
  });

  it('rakam dışındaki karakterleri atar', () => {
    expect(normalizePhone('(0532) 123 45 67')).toBe('5321234567');
  });

  it('tanınmayan uzunlukta rakamları olduğu gibi bırakır', () => {
    // Kısmi arama terimlerinde de kullanılıyor; agresif kırpma
    // "532" aramasını bozardı.
    expect(normalizePhone('532')).toBe('532');
  });
});

describe('Public uç rate limitleri', () => {
  /*
   * Bu değerler e2e ile doğrulanamıyor: ThrottlerModule test ortamında
   * kapalı (app.module.ts -> skipIf: config.isTest). Yapılandırmanın
   * yanlışlıkla gevşetilmesini yakalayan tek koruma bu test.
   */
  it('talep gönderme saatte 5 istekle sınırlıdır', () => {
    expect(CREATE_THROTTLE.default.limit).toBe(5);
    expect(CREATE_THROTTLE.default.ttl).toBe(3_600_000);
  });

  it('sepet doğrulama daha gevşek ama sınırsız değildir', () => {
    expect(VALIDATE_THROTTLE.default.limit).toBe(60);
    expect(VALIDATE_THROTTLE.default.ttl).toBe(60_000);
    // Doğrulama, talep göndermeden daha sık çağrılır.
    expect(VALIDATE_THROTTLE.default.limit).toBeGreaterThan(CREATE_THROTTLE.default.limit);
  });
});
