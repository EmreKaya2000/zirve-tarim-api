import { validateEnv } from './env.validation';

/**
 * Ortam doğrulaması, yanlış yapılandırmayla üretime çıkmayı engelleyen
 * ilk savunma hattıdır (docs/ARCHITECTURE.md §11.1). Bu testler o savunmanın
 * gerçekten çalıştığını kanıtlar.
 */
describe('validateEnv', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    // Sprint 11: müşteri jetonu ayrı bir sırla imzalanır ve varsayılanı yoktur.
    JWT_CUSTOMER_ACCESS_SECRET: 'c'.repeat(32),
  };

  describe('geçerli yapılandırma', () => {
    it('asgari zorunlu alanlarla geçer ve varsayılanları doldurur', () => {
      const env = validateEnv({ ...validBase });

      expect(env.NODE_ENV).toBe('development');
      expect(env.API_PORT).toBe(4000);
      expect(env.API_PREFIX).toBe('api/v1');
      expect(env.THROTTLE_TTL).toBe(60);
      expect(env.THROTTLE_LIMIT).toBe(120);
    });

    it('string sayıları int e çevirir', () => {
      const env = validateEnv({ ...validBase, API_PORT: '8080', THROTTLE_LIMIT: '500' });

      expect(env.API_PORT).toBe(8080);
      expect(env.THROTTLE_LIMIT).toBe(500);
    });

    it('boolean benzeri string leri boolean a çevirir', () => {
      expect(validateEnv({ ...validBase, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
      expect(validateEnv({ ...validBase, SWAGGER_ENABLED: '0' }).SWAGGER_ENABLED).toBe(false);
      expect(validateEnv({ ...validBase, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
      expect(validateEnv({ ...validBase, SWAGGER_ENABLED: 'YES' }).SWAGGER_ENABLED).toBe(true);
    });

    it('boş string te varsayılanı kullanır', () => {
      expect(validateEnv({ ...validBase, API_PORT: '' }).API_PORT).toBe(4000);
    });
  });

  describe('zorunlu alanlar', () => {
    it('DATABASE_URL yoksa reddeder', () => {
      expect(() => validateEnv({ ...validBase, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    });

    it('PostgreSQL olmayan DATABASE_URL i reddeder', () => {
      expect(() => validateEnv({ ...validBase, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
        /PostgreSQL/,
      );
    });

    it('kısa JWT sırrını reddeder', () => {
      expect(() => validateEnv({ ...validBase, JWT_ACCESS_SECRET: 'kisa' })).toThrow(
        /en az 32 karakter/,
      );
    });

    it('müşteri jeton sırrı yoksa reddeder', () => {
      // Varsayılana düşülseydi audience ayrımı TEK savunma katmanı kalırdı.
      expect(() => validateEnv({ ...validBase, JWT_CUSTOMER_ACCESS_SECRET: undefined })).toThrow(
        /JWT_CUSTOMER_ACCESS_SECRET/,
      );
    });

    it('geçersiz NODE_ENV i reddeder', () => {
      expect(() => validateEnv({ ...validBase, NODE_ENV: 'staging' })).toThrow();
    });

    it('aralık dışı port u reddeder', () => {
      expect(() => validateEnv({ ...validBase, API_PORT: '99999' })).toThrow();
    });
  });

  describe('üretim ortamı sertleştirmesi', () => {
    const productionBase = {
      ...validBase,
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'K7pQ2xR9mW4nB6vT8yU3iO5aS1dF0gH2jL4kZ9cX7bN5mQ8w',
      JWT_REFRESH_SECRET: 'Z3xC8vB2nM6qW9eR4tY7uI1oP5aS0dF3gH6jK9lZ2xC5vB8n',
      JWT_CUSTOMER_ACCESS_SECRET: 'Q4wE7rT2yU9iO5pA1sD8fG3hJ6kL0zX4cV7bN2mQ9wE6rT3y',
      SEED_SUPER_ADMIN_PASSWORD: 'UretimIcinGuclüSifre#2026',
      // Sprint 11: üretimde e-postayı loglamak, hiç göndermemek demektir.
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.ornek.com',
    };

    it('sertleştirilmiş üretim yapılandırmasını kabul eder', () => {
      expect(() => validateEnv(productionBase)).not.toThrow();
    });

    it('yer tutucu sırrı reddeder', () => {
      expect(() =>
        validateEnv({
          ...productionBase,
          JWT_ACCESS_SECRET: 'degistirin-en-az-32-karakter-olmali-dev-only',
        }),
      ).toThrow(/yer tutucu/);
    });

    it('access ve refresh sırrının aynı olmasını reddeder', () => {
      const sameSecret = 'P9oI8uY7tR6eW5qA4sD3fG2hJ1kL0zX9cV8bN7mQ6wE5rT4y';

      expect(() =>
        validateEnv({
          ...productionBase,
          JWT_ACCESS_SECRET: sameSecret,
          JWT_REFRESH_SECRET: sameSecret,
        }),
      ).toThrow(/aynı olamaz/);
    });

    it('müşteri ve yönetici sırrının aynı olmasını reddeder', () => {
      const sameSecret = 'M4nB7vC2xZ9lK6jH3gF0dS5aP8oI1uY4tR7eW2qA9sD6fG3h';

      expect(() =>
        validateEnv({
          ...productionBase,
          JWT_ACCESS_SECRET: sameSecret,
          JWT_CUSTOMER_ACCESS_SECRET: sameSecret,
        }),
      ).toThrow(/JWT_CUSTOMER_ACCESS_SECRET/);
    });

    it('log posta sürücüsünü reddeder', () => {
      // Doğrulama bağlantısı gönderilmezse kullanıcı hesabını doğrulayamaz.
      expect(() => validateEnv({ ...productionBase, MAIL_DRIVER: 'log' })).toThrow(/MAIL_DRIVER/);
    });

    it('SMTP sürücüsünde SMTP_HOST suz yapılandırmayı reddeder', () => {
      expect(() => validateEnv({ ...productionBase, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
    });

    it('joker CORS u reddeder', () => {
      expect(() => validateEnv({ ...productionBase, CORS_ORIGINS: '*' })).toThrow(/joker/);
    });

    it('açık Swagger ı reddeder', () => {
      expect(() => validateEnv({ ...productionBase, SWAGGER_ENABLED: 'true' })).toThrow(/Swagger/);
    });

    it('varsayılan seed şifresini reddeder', () => {
      // Üretimde bilinen bir şifreyle SUPER_ADMIN yaratılması felakettir.
      expect(() =>
        validateEnv({ ...productionBase, SEED_SUPER_ADMIN_PASSWORD: 'ZirveTarim2026' }),
      ).toThrow(/SEED_SUPER_ADMIN_PASSWORD/);
    });

    it('geçersiz seed e-postasını reddeder', () => {
      expect(() =>
        validateEnv({ ...productionBase, SEED_SUPER_ADMIN_EMAIL: 'eposta-degil' }),
      ).toThrow(/SEED_SUPER_ADMIN_EMAIL/);
    });

    it('aynı kontroller geliştirme ortamında uygulanmaz', () => {
      expect(() =>
        validateEnv({
          ...validBase,
          NODE_ENV: 'development',
          CORS_ORIGINS: '*',
          SWAGGER_ENABLED: 'true',
          JWT_ACCESS_SECRET: 'degistirin-en-az-32-karakter-olmali-dev-only',
        }),
      ).not.toThrow();
    });
  });

  describe('hata mesajı', () => {
    it('tüm sorunları tek seferde ve alan adıyla listeler', () => {
      let message = '';

      try {
        validateEnv({ DATABASE_URL: 'mysql://x', JWT_ACCESS_SECRET: 'kisa' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('JWT_REFRESH_SECRET');
      expect(message).toContain('JWT_CUSTOMER_ACCESS_SECRET');
      expect(message).toContain('.env.example');
    });
  });
});
