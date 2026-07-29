import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppConfig } from './config/app.config';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { BenefitsModule } from './modules/benefits/benefits.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { HealthModule } from './modules/health/health.module';
import { PlantsModule } from './modules/plants/plants.module';
import { ProductRelationsModule } from './modules/product-relations/product-relations.module';
import { ProductVariantsModule } from './modules/product-variants/product-variants.module';
import { ProductsModule } from './modules/products/products.module';
import { PublicCatalogModule } from './modules/public-catalog/public-catalog.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SideEffectsModule } from './modules/side-effects/side-effects.module';
import { SoilTypesModule } from './modules/soil-types/soil-types.module';
import { UnitTypesModule } from './modules/unit-types/unit-types.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CartModule } from './modules/cart/cart.module';
import { CustomerAccountsModule } from './modules/customer-accounts/customer-accounts.module';
import { CustomerAuthModule } from './modules/customer-auth/customer-auth.module';
import { CustomerJwtGuard } from './modules/customer-auth/guards/customer-jwt.guard';
import { CustomerInquiriesModule } from './modules/customer-inquiries/customer-inquiries.module';
import { MailModule } from './modules/mail/mail.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SalesModule } from './modules/sales/sales.module';
import { StockModule } from './modules/stock/stock.module';
import { FinanceModule } from './modules/finance/finance.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsagePeriodsModule } from './modules/usage-periods/usage-periods.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Uygulamanın kök modülü.
 *
 * Global sağlayıcılar burada tanımlanır; böylece her modül otomatik olarak
 * aynı yanıt formatına, hata işlemeye, hız sınırına ve kimlik doğrulamasına
 * tabi olur.
 *
 * GUARD SIRASI ÖNEMLİDİR — kayıt sırasıyla çalışırlar:
 *   1. ThrottlerGuard   : kimlik doğrulamadan ÖNCE, kaba kuvvet trafiğini keser
 *   2. JwtAuthGuard     : YÖNETİCİ jetonunu doğrular, request.user'ı doldurur
 *   3. RolesGuard       : request.user.role'ü kontrol eder
 *   4. CustomerJwtGuard : MÜŞTERİ jetonunu doğrular, request.customer'ı doldurur
 *
 * 2 ve 3, `@CustomerAuth()` ile işaretli uçları ATLAR; 4 ise yalnız o uçlarda
 * devreye girer. Böylece iki kimlik alanı aynı uygulamada birbirine
 * karışmadan yaşar (docs/ARCHITECTURE.md §8.4).
 *
 * Güvenli varsayılan: her uç korumalıdır. Muafiyet @Public() ile açılır
 * (docs/ARCHITECTURE.md §8.3).
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            ttl: config.throttleTtlSeconds * 1000,
            limit: config.throttleLimit,
          },
        ],
        /*
         * Hız sınırı test ortamında kapatılır.
         *
         * Giriş ucundaki 5/dk sınırı `@Throttle` dekoratörüyle sabittir ve
         * ortam değişkeniyle gevşetilemez; e2e paketi tek IP'den onlarca
         * giriş yaptığı için testler birbirini düşürürdü.
         *
         * Sınırın kendisi ayrıca doğrulanmalıdır (Sprint 9 güvenlik testleri).
         */
        skipIf: () => config.isTest,
      }),
    }),
    CommonModule,
    AuditLogsModule,
    AuthModule,
    UsersModule,

    // --- Katalog taksonomisi (Sprint 3) ---
    CategoriesModule,
    BrandsModule,
    PlantsModule,
    SoilTypesModule,
    BenefitsModule,
    SideEffectsModule,
    UsagePeriodsModule,
    UnitTypesModule,
    SettingsModule,

    // --- Ürün (Sprint 4) ---
    ProductsModule,
    ProductVariantsModule,
    ProductRelationsModule,
    UploadsModule,
    InquiriesModule,

    // --- Satış zinciri (Sprint 8) ---
    CustomersModule,
    SalesModule,
    PaymentsModule,

    // --- Stok (Sprint 9) ---
    StockModule,

    // --- Finans ve raporlar (Sprint 10) ---
    ReportsModule,
    FinanceModule,

    // --- Müşteri hesabı, sunucu sepeti ve talep geçmişi (Sprint 11) ---
    MailModule,
    CustomerAuthModule,
    CustomerAccountsModule,
    CartModule,
    CustomerInquiriesModule,

    PublicCatalogModule,

    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CustomerJwtGuard,
    },
  ],
})
export class AppModule {}
