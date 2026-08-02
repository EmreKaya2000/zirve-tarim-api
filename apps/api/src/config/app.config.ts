import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from './env.validation';

/**
 * Doğrulanmış ortam değişkenlerine tip güvenli erişim.
 *
 * Kod içinde `process.env` veya ham `configService.get('X')` kullanılmaz;
 * her şey buradan okunur. Böylece isim hataları derleme zamanında yakalanır.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.configService.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get port(): number {
    return this.get('API_PORT');
  }

  get apiPrefix(): string {
    return this.get('API_PREFIX');
  }

  get swaggerPath(): string {
    return this.get('SWAGGER_PATH');
  }

  get swaggerEnabled(): boolean {
    return this.get('SWAGGER_ENABLED');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  /** Virgülle ayrılmış CORS listesini diziye çevirir. */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get throttleTtlSeconds(): number {
    return this.get('THROTTLE_TTL');
  }

  get throttleLimit(): number {
    return this.get('THROTTLE_LIMIT');
  }

  get jwtAccessSecret(): string {
    return this.get('JWT_ACCESS_SECRET');
  }

  get jwtRefreshSecret(): string {
    return this.get('JWT_REFRESH_SECRET');
  }

  get jwtAccessExpiresIn(): string {
    return this.get('JWT_ACCESS_EXPIRES_IN');
  }

  get jwtRefreshExpiresIn(): string {
    return this.get('JWT_REFRESH_EXPIRES_IN');
  }

  // --- Müşteri (public) kimlik doğrulama — Sprint 11 ---

  get jwtCustomerAccessSecret(): string {
    return this.get('JWT_CUSTOMER_ACCESS_SECRET');
  }

  get jwtCustomerAccessExpiresIn(): string {
    return this.get('JWT_CUSTOMER_ACCESS_EXPIRES_IN');
  }

  get jwtCustomerRefreshExpiresIn(): string {
    return this.get('JWT_CUSTOMER_REFRESH_EXPIRES_IN');
  }

  // --- E-posta — Sprint 11 ---

  get mailDriver(): Env['MAIL_DRIVER'] {
    return this.get('MAIL_DRIVER');
  }

  get mailFromAddress(): string {
    return this.get('MAIL_FROM_ADDRESS');
  }

  get mailFromName(): string {
    return this.get('MAIL_FROM_NAME');
  }

  get smtpHost(): string | undefined {
    return this.get('SMTP_HOST');
  }

  get smtpPort(): number {
    return this.get('SMTP_PORT');
  }

  get smtpSecure(): boolean {
    return this.get('SMTP_SECURE');
  }

  get smtpUser(): string | undefined {
    return this.get('SMTP_USER');
  }

  get smtpPassword(): string | undefined {
    return this.get('SMTP_PASSWORD');
  }

  /** E-posta bağlantılarının kök adresi; sondaki eğik çizgi atılır. */
  get publicWebUrl(): string {
    return this.get('PUBLIC_WEB_URL').replace(/\/+$/, '');
  }

  /** Yönetim paneli kök adresi; sondaki eğik çizgi atılır. */
  get adminPanelUrl(): string {
    return this.get('ADMIN_PANEL_URL').replace(/\/+$/, '');
  }

  /** Yeni talep bildiriminin gideceği adres; tanımsızsa bildirim gönderilmez. */
  get adminNotificationEmail(): string | undefined {
    return this.get('ADMIN_NOTIFICATION_EMAIL');
  }
}
