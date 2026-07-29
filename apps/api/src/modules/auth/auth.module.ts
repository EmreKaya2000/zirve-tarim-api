import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AppConfig } from '../../config/app.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { parseDuration, TokenService } from './token.service';

/**
 * Kimlik doğrulama modülü.
 *
 * Global'dir: JwtAuthGuard ve RolesGuard app.module.ts içinde APP_GUARD olarak
 * kaydedildiği için JwtService ve bağımlılıklarının her yerden çözülebilmesi
 * gerekir.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        // Saniye (number) olarak verilir; gerekçe için token.service.ts.
        signOptions: { expiresIn: parseDuration(config.jwtAccessExpiresIn) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  exports: [AuthService, PasswordService, TokenService, JwtModule],
})
export class AuthModule {}
