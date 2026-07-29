import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { AppConfig } from './app.config';
import { validateEnv } from './env.validation';

/**
 * Global yapılandırma modülü.
 *
 * `.env` monorepo kökünden okunur; Docker içinde değişkenler doğrudan
 * ortamdan gelir ve dosya bulunamaması sorun değildir.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Kökteki .env, ardından apps/api/.env (varsa) okunur.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
      expandVariables: true,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
