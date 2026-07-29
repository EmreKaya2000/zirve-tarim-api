import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_ROLE_LABELS, type UserRole } from '@zirve/types';

import { AppException } from '../../../common/exceptions/app.exception';
import { IS_CUSTOMER_ROUTE_KEY } from '../decorators/customer-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * MVP'de yönetim paneline erişebilen roller.
 *
 * `@Roles()` verilmemiş her korumalı uç için varsayılan budur. Enum'daki
 * diğer roller (MANAGER, SALES_STAFF...) bugün hiçbir uca erişemez —
 * ileride yetkilendirildiklerinde bu liste genişletilir.
 */
const DEFAULT_ALLOWED_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

interface AuthenticatedRequest {
  user?: RequestUser;
}

/**
 * Rol tabanlı yetkilendirme. GLOBAL guard'dır ve JwtAuthGuard'dan SONRA çalışır.
 *
 * docs/ARCHITECTURE.md §8.3
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    // Müşteri hesabının `role` alanı YOKTUR ve olmamalıdır: rol yönetim
    // panelinin yetki modelidir. Müşteri uçlarında yetki, kaydın sahipliğiyle
    // belirlenir (kendi sepeti, kendi talebi) — CustomerJwtGuard ve servisler.
    const isCustomerRoute = this.reflector.getAllAndOverride<boolean>(IS_CUSTOMER_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isCustomerRoute === true) {
      return true;
    }

    const required =
      this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ALLOWED_ROLES;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (user === undefined) {
      // JwtAuthGuard çalışmadan buraya gelinmiş demektir — yapılandırma hatası.
      throw AppException.unauthorized();
    }

    if (!required.includes(user.role)) {
      throw AppException.forbidden(
        `Bu işlem için yetkiniz yok. Gerekli rol: ${required
          .map((role) => USER_ROLE_LABELS[role])
          .join(' veya ')}.`,
      );
    }

    return true;
  }
}
