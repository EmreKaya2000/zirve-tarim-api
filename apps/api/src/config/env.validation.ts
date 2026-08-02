import { z } from 'zod';

/**
 * Ortam değişkeni şeması.
 *
 * Uygulama açılışında doğrulanır; eksik veya geçersiz bir değer varsa
 * uygulama BAŞLAMAZ. Bu, yanlış yapılandırmayla (ör. varsayılan JWT sırrıyla)
 * üretime çıkma riskini ortadan kaldırır — docs/ARCHITECTURE.md §11.1.
 */

/** Geliştirme için konulan, üretimde kabul edilmeyecek yer tutucu sır değerleri. */
const INSECURE_SECRET_MARKERS = ['degistirin', 'changeme', 'dev-only', 'secret', 'password'];

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

/** "1", "true", "yes" gibi değerleri boolean'a çevirir. */
const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') {
        return defaultValue;
      }
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

/** Sayısal ortam değişkenleri string gelir; güvenli biçimde int'e çevirir. */
const intFromString = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? defaultValue : value))
    .pipe(z.coerce.number().int().min(min).max(max));

export const envSchema = z
  .object({
    // --- Genel ---
    NODE_ENV: nodeEnvSchema.default('development'),

    // --- Veritabanı ---
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL zorunludur.')
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL bir PostgreSQL bağlantı adresi olmalıdır (postgresql:// ile başlamalı).',
      ),

    // --- API ---
    API_PORT: intFromString(4000, 1, 65535),
    API_PREFIX: z.string().default('api/v1'),
    SWAGGER_PATH: z.string().default('docs'),
    SWAGGER_ENABLED: booleanFromString(true),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),

    // --- Güvenlik (Sprint 2'de kullanılmaya başlanacak) ---
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET en az 32 karakter olmalıdır.'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET en az 32 karakter olmalıdır.'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    /**
     * Müşteri (public) erişim jetonunun sırrı — Sprint 11.
     *
     * VARSAYILANI YOKTUR ve olmamalıdır. Yönetici sırrına düşülseydi
     * audience ayrımı tek savunma katmanı olarak kalırdı; ayrı sır,
     * müşteri jetonunun admin uçlarında imza seviyesinde reddedilmesini
     * sağlar (docs/ARCHITECTURE.md §8.4).
     */
    JWT_CUSTOMER_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_CUSTOMER_ACCESS_SECRET en az 32 karakter olmalıdır.'),

    /**
     * Müşteri jetonlarının ömrü.
     *
     * Erişim jetonu yöneticininkinden UZUN (30 dk): vitrinde kullanıcı sepete
     * ürün eklerken oturumun sessizce yenilenmesi gerekmesin. Yenileme jetonu
     * ise DAHA UZUN (30 gün): çiftçi ayda bir kez talep gönderiyorsa her
     * seferinde şifre sormak akışı bozar. Yönetim paneli hassas veri
     * gösterdiği için kendi kısa sürelerini korur.
     */
    JWT_CUSTOMER_ACCESS_EXPIRES_IN: z.string().default('30m'),
    JWT_CUSTOMER_REFRESH_EXPIRES_IN: z.string().default('30d'),

    // --- E-posta (Sprint 11) ---

    /**
     * Posta sürücüsü.
     *
     * `log`  : e-postayı göndermez, gövdesini loglar. Geliştirme varsayılanı.
     * `smtp` : gerçek SMTP sunucusuna gönderir; SMTP_* değerleri zorunlu olur.
     */
    MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    MAIL_FROM_ADDRESS: z
      .string()
      .email('MAIL_FROM_ADDRESS geçerli bir e-posta olmalıdır.')
      .default('no-reply@zirvetarim.local'),
    MAIL_FROM_NAME: z.string().default('Zirve Tarım'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587, 1, 65535),
    SMTP_SECURE: booleanFromString(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    /**
     * E-posta bağlantılarının işaret ettiği vitrin adresi.
     *
     * Doğrulama ve şifre sıfırlama bağlantıları BU adres üzerinden kurulur.
     * İsteğin `Host` başlığından türetilmez: saldırgan o başlığı değiştirerek
     * sıfırlama bağlantısını kendi alan adına yönlendirebilirdi
     * (host header injection).
     */
    PUBLIC_WEB_URL: z
      .string()
      .url('PUBLIC_WEB_URL geçerli bir adres olmalıdır.')
      .default('http://localhost:3000'),

    /**
     * Yeni talep bildiriminin gideceği yönetim adresi.
     *
     * BOŞSA BİLDİRİM GÖNDERİLMEZ ve bu bir hata değildir: kurulumun her
     * ortamında bir yönetim kutusu olmayabilir (ör. geliştirici makinesi).
     * Zorunlu yapmak, adresi olmayan ortamlarda uygulamayı başlatmazdı.
     */
    ADMIN_NOTIFICATION_EMAIL: z
      .string()
      .email('ADMIN_NOTIFICATION_EMAIL geçerli bir e-posta olmalıdır.')
      .optional(),

    /**
     * Yönetim paneli adresi — bildirim e-postasındaki bağlantı buraya gider.
     *
     * PUBLIC_WEB_URL'den AYRI: depo bölünmesinden sonra panel ayrı bir
     * uygulama ve ayrı bir alan adında yayınlanır.
     */
    ADMIN_PANEL_URL: z
      .string()
      .url('ADMIN_PANEL_URL geçerli bir adres olmalıdır.')
      .default('http://localhost:3001'),

    // --- Rate limit ---
    THROTTLE_TTL: intFromString(60, 1, 86_400),
    THROTTLE_LIMIT: intFromString(120, 1, 100_000),

    // --- Seed: ilk SUPER_ADMIN ---
    // Yalnız seed betiği okur. Kod içinde sabit yazılmaz (Kural 12) ve
    // depoya girmemesi için .env'den gelir.
    SEED_SUPER_ADMIN_EMAIL: z
      .string()
      .email('SEED_SUPER_ADMIN_EMAIL geçerli bir e-posta olmalıdır.')
      .default('admin@zirvetarim.local'),
    SEED_SUPER_ADMIN_PASSWORD: z
      .string()
      .min(10, 'SEED_SUPER_ADMIN_PASSWORD en az 10 karakter olmalıdır.')
      .default('ZirveTarim2026'),
    SEED_SUPER_ADMIN_NAME: z.string().min(3).default('Sistem Yöneticisi'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }

    // Üretimde yer tutucu sırların kullanılması engellenir.
    const secretFields = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'JWT_CUSTOMER_ACCESS_SECRET',
    ] as const;

    for (const field of secretFields) {
      const value = env[field].toLowerCase();
      if (INSECURE_SECRET_MARKERS.some((marker) => value.includes(marker))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} üretim ortamında varsayılan/yer tutucu bir değer içeremez. Yeni bir sır üretin: openssl rand -base64 48`,
        });
      }
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET, JWT_ACCESS_SECRET ile aynı olamaz.',
      });
    }

    // Müşteri sırrı yönetici sırrıyla aynı olursa audience ayrımı TEK savunma
    // katmanı olarak kalır; ayrı sır, imza seviyesinde de ayrışmayı sağlar.
    if (env.JWT_CUSTOMER_ACCESS_SECRET === env.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_CUSTOMER_ACCESS_SECRET'],
        message: 'JWT_CUSTOMER_ACCESS_SECRET, JWT_ACCESS_SECRET ile aynı olamaz.',
      });
    }

    // SMTP sürücüsü seçildiyse sunucu adresi olmadan hiçbir e-posta gitmez;
    // sessizce başarısız olan bir şifre sıfırlama akışı, hiç olmayandan
    // kötüdür (kullanıcı beklemeye devam eder).
    if (env.MAIL_DRIVER === 'smtp' && (env.SMTP_HOST ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'MAIL_DRIVER=smtp iken SMTP_HOST zorunludur.',
      });
    }

    // Üretimde e-postayı loglamak, doğrulama bağlantısının hiç gönderilmemesi
    // demektir: kullanıcı hesabını doğrulayamaz.
    if (env.MAIL_DRIVER === 'log') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DRIVER'],
        message:
          'MAIL_DRIVER üretim ortamında "log" olamaz; e-postalar gönderilmez. "smtp" kullanın.',
      });
    }

    if (env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS üretim ortamında joker (*) içeremez.',
      });
    }

    // Üretimde varsayılan seed şifresiyle bir SUPER_ADMIN yaratılması felakettir.
    if (env.SEED_SUPER_ADMIN_PASSWORD === 'ZirveTarim2026') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_SUPER_ADMIN_PASSWORD'],
        message:
          'SEED_SUPER_ADMIN_PASSWORD üretim ortamında varsayılan değerde bırakılamaz. Güçlü bir şifre belirleyin.',
      });
    }

    if (env.SWAGGER_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SWAGGER_ENABLED'],
        message:
          'Swagger üretim ortamında kapalı olmalıdır. SWAGGER_ENABLED=false yapın veya bilinçli olarak bu kontrolü kaldırın.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * `@nestjs/config` içinde `validate` olarak kullanılır.
 * Hata durumunda okunabilir bir mesajla fırlatır ve uygulama başlamaz.
 */
export function validateEnv(rawConfig: Record<string, unknown>): Env {
  const result = envSchema.safeParse(rawConfig);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Ortam değişkenleri doğrulanamadı. Uygulama başlatılmıyor.\n${issues}\n\n` +
        'Eksik değerler için .env.example dosyasına bakın.',
    );
  }

  return result.data;
}
