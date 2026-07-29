import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, TOKEN_AUDIENCES, TOKEN_ISSUER, type CustomerJwtPayload } from '@zirve/types';

import { AppConfig } from '../../../config/app.config';
import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { IS_CUSTOMER_ROUTE_KEY } from '../../auth/decorators/customer-auth.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import type { RequestCustomer } from '../decorators/current-customer.decorator';

interface CustomerRequest {
  headers: Record<string, string | string[] | undefined>;
  customer?: RequestCustomer;
}

/**
 * Müşteri access token doğrulaması. GLOBAL guard'dır (app.module.ts) ve
 * YALNIZ `@CustomerAuth()` ile işaretli uçlarda devreye girer.
 *
 * ÜÇ KATMANLI AYRIM (docs/ARCHITECTURE.md §8.4) — yönetici jetonunun burada
 * kabul edilmesi imkânsızdır:
 *   1. Farklı imza sırrı (`JWT_CUSTOMER_ACCESS_SECRET`)
 *   2. Farklı audience (`aud: zirve-customer`)
 *   3. Farklı tablo: `sub` değeri `customer_accounts` içinde aranır. Yönetici
 *      jetonunun `sub`u bir `users.id`dir ve burada karşılığı yoktur.
 *
 * Jeton geçerli olsa bile hesap VERİTABANINDAN doğrulanır: pasife alınan veya
 * silinen bir hesabın elindeki jeton, süresi dolana kadar geçerli kalmamalıdır.
 */
@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isCustomerRoute = this.reflector.getAllAndOverride<boolean>(IS_CUSTOMER_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Müşteri ucu değilse bu guard'ın söyleyecek bir şeyi yok; yönetici
    // uçlarını JwtAuthGuard zaten korudu.
    if (isCustomerRoute !== true) {
      return true;
    }

    // Aynı denetleyicideki kayıt/giriş uçları kimlik istemez.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const token = extractBearerToken(request.headers['authorization']);

    if (token === null) {
      throw AppException.unauthorized(ERROR_CODES.UNAUTHORIZED);
    }

    const payload = await this.verifyToken(token);
    const account = await this.loadActiveAccount(payload.sub);

    request.customer = {
      id: account.id,
      email: account.email,
      tokenId: payload.jti,
      isEmailVerified: account.emailVerifiedAt !== null,
    };

    return true;
  }

  private async verifyToken(token: string): Promise<CustomerJwtPayload> {
    try {
      return await this.jwtService.verifyAsync<CustomerJwtPayload>(token, {
        secret: this.config.jwtCustomerAccessSecret,
        audience: TOKEN_AUDIENCES.CUSTOMER,
        issuer: TOKEN_ISSUER,
      });
    } catch (error) {
      // Süresi dolan jeton ayrı bir kodla bildirilir; istemci bunu görünce
      // sessizce refresh dener, kullanıcıyı giriş ekranına atmaz.
      const isExpired = error instanceof Error && error.name === 'TokenExpiredError';

      throw AppException.unauthorized(
        isExpired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHORIZED,
      );
    }
  }

  /** Hesabın hâlâ var ve aktif olduğunu doğrular. */
  private async loadActiveAccount(accountId: string) {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, email: true, isActive: true, emailVerifiedAt: true },
    });

    if (account === null) {
      throw AppException.unauthorized(ERROR_CODES.UNAUTHORIZED);
    }

    if (!account.isActive) {
      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return account;
  }
}

/** `Authorization: Bearer <token>` başlığından jetonu ayıklar. */
function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined || value === null) {
    return null;
  }

  const [scheme, token] = value.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return null;
  }

  return token;
}
