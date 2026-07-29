import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';

import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerContextService } from './customer-context.service';
import { CustomerProfileController } from './customer-profile.controller';
import { CustomerTokenService } from './customer-token.service';

/**
 * Müşteri (public) kimlik doğrulama modülü — Sprint 11.
 *
 * `PasswordService`, `TokenService` ve `JwtService` global AuthModule'den
 * gelir; burada yeniden sağlanmaz — şifre parametrelerinin (Argon2 maliyeti)
 * iki yerde ayrışması, yönetici ve müşteri şifrelerinin farklı güçte
 * saklanması anlamına gelirdi.
 *
 * `CustomerTokenService` DIŞARIYA VERİLİR: CustomerJwtGuard global bir
 * guard'dır ve app.module.ts içinde çözülür.
 */
@Module({
  imports: [MailModule],
  controllers: [CustomerAuthController, CustomerProfileController],
  providers: [CustomerAuthService, CustomerTokenService, CustomerContextService],
  // `CustomerContextService` InquiriesModule tarafından kullanılır: public
  // talep ucu, giriş yapmış bir müşteriyi İSTEĞE BAĞLI olarak tanır.
  exports: [CustomerAuthService, CustomerTokenService, CustomerContextService],
})
export class CustomerAuthModule {}
