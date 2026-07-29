import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, TOKEN_AUDIENCES, TOKEN_ISSUER, type JwtPayload } from '@zirve/types';

import { AppConfig } from '../../../config/app.config';
import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { IS_CUSTOMER_ROUTE_KEY } from '../decorators/customer-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: RequestUser;
}

/**
 * Access token doğrulaması. GLOBAL guard'dır (app.module.ts).
 *
 * `@Public()` ile işaretli uçlar atlanır. Diğer her uç geçerli bir
 * `Authorization: Bearer <token>` başlığı ister.
 *
 * Jeton geçerli olsa bile kullanıcı VERİTABANINDAN doğrulanır: pasife alınan
 * veya silinen bir kullanıcının elindeki jeton, süresi dolana kadar geçerli
 * kalmamalıdır (iş kuralı: pasif kullanıcı erişemez).
 *
 * SPRINT 11 — AUDIENCE AYRIMI: yalnız `aud: zirve-admin` taşıyan jetonlar
 * kabul edilir. Müşteri jetonu hem farklı bir sırla imzalanmıştır hem de
 * farklı bir audience taşır; ikisi de bu doğrulamada başarısız olur.
 * Kontrol `verifyAsync` seçeneği olarak verilir — guard içinde elle
 * karşılaştırma yazılsaydı ileride biri onu kaldırabilirdi.
 *
 * `@CustomerAuth()` ile işaretli uçlar atlanır; onları CustomerJwtGuard
 * korur.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    // Müşteri ucu: yönetici kimliği aranmaz, CustomerJwtGuard devralır.
    const isCustomerRoute = this.reflector.getAllAndOverride<boolean>(IS_CUSTOMER_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isCustomerRoute === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers['authorization']);

    if (token === null) {
      throw AppException.unauthorized(ERROR_CODES.UNAUTHORIZED);
    }

    const payload = await this.verifyToken(token);
    const user = await this.loadActiveUser(payload.sub);

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenId: payload.jti,
    };

    return true;
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.jwtAccessSecret,
        audience: TOKEN_AUDIENCES.ADMIN,
        issuer: TOKEN_ISSUER,
      });
    } catch (error) {
      // Süresi dolan jeton istemciye ayrı bir kodla bildirilir; istemci bunu
      // görünce sessizce refresh dener, kullanıcıyı login'e atmaz.
      const isExpired = error instanceof Error && error.name === 'TokenExpiredError';

      throw AppException.unauthorized(
        isExpired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHORIZED,
      );
    }
  }

  /** Kullanıcının hâlâ var ve aktif olduğunu doğrular. */
  private async loadActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (user === null) {
      throw AppException.unauthorized(ERROR_CODES.UNAUTHORIZED);
    }

    if (!user.isActive) {
      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return user;
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
