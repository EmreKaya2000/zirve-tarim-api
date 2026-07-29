import { redact } from './audit-logs.service';

/**
 * Denetim kaydına şifre veya jeton sızması, tespit edilmesi zor ve etkisi
 * büyük bir güvenlik hatasıdır. Bu testler maskelemenin çalıştığını kanıtlar.
 */
describe('redact', () => {
  it('şifre alanlarını maskeler', () => {
    const result = redact({
      email: 'admin@example.com',
      password: 'gizli123',
      passwordHash: '$argon2id$v=19$...',
    }) as Record<string, unknown>;

    expect(result['email']).toBe('admin@example.com');
    expect(result['password']).toBe('[gizlendi]');
    expect(result['passwordHash']).toBe('[gizlendi]');
  });

  it('jeton alanlarını maskeler', () => {
    const result = redact({
      tokenHash: 'abc123',
      accessToken: 'eyJhbGci...',
      refreshToken: 'raw-token',
      replacedByTokenHash: 'def456',
    }) as Record<string, unknown>;

    expect(Object.values(result)).toEqual(['[gizlendi]', '[gizlendi]', '[gizlendi]', '[gizlendi]']);
  });

  it('iç içe nesnelerde de maskeler', () => {
    const result = redact({
      user: { fullName: 'Ayşe Yılmaz', passwordHash: 'gizli' },
    }) as { user: Record<string, unknown> };

    expect(result.user['fullName']).toBe('Ayşe Yılmaz');
    expect(result.user['passwordHash']).toBe('[gizlendi]');
  });

  it('dizi içindeki nesnelerde de maskeler', () => {
    const result = redact([{ password: 'a' }, { password: 'b' }]) as Record<string, unknown>[];

    expect(result[0]?.['password']).toBe('[gizlendi]');
    expect(result[1]?.['password']).toBe('[gizlendi]');
  });

  it('hassas olmayan alanları değiştirmez', () => {
    const input = { fullName: 'Emre', role: 'ADMIN', isActive: true, phone: null };

    expect(redact(input)).toEqual(input);
  });

  it('Date değerlerini ISO string e çevirir', () => {
    const date = new Date('2026-07-28T10:00:00.000Z');
    const result = redact({ createdAt: date }) as Record<string, unknown>;

    expect(result['createdAt']).toBe('2026-07-28T10:00:00.000Z');
  });

  it('null ve undefined ı olduğu gibi bırakır', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('ilkel değerleri olduğu gibi bırakır', () => {
    expect(redact('metin')).toBe('metin');
    expect(redact(42)).toBe(42);
    expect(redact(false)).toBe(false);
  });
});
