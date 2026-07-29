import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { UserRole } from '@zirve/types';

export const ROLES_KEY = 'roles';

/**
 * Bir uca erişebilecek rolleri kısıtlar.
 *
 * Dekoratör yoksa RolesGuard varsayılan olarak [SUPER_ADMIN, ADMIN] uygular;
 * yani panel kullanıcıları erişebilir. Daha dar bir kısıt gerekiyorsa
 * (ör. yalnız SUPER_ADMIN) burada açıkça belirtilir.
 *
 * @example
 * ＠Roles(UserRoleEnum.SUPER_ADMIN)
 * ＠Delete(':id')
 * remove() {}
 */
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
