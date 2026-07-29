import { Prisma } from '@prisma/client';
import type { CustomerAccountProfile } from '@zirve/types';

/**
 * Müşteri hesabının PUBLIC seçicisi ve gösterimi.
 *
 * KURAL 8: seçici AÇIK tutulur, `include` KULLANILMAZ. `customer_accounts`
 * tablosunda `passwordHash`, `failedLoginCount`, `lockedUntil` ve
 * `consentIpAddress` gibi alanlar var; hiçbiri müşteriye dönmez. Bir gün
 * tabloya yeni bir hassas alan eklenirse bu seçici onu sessizce dışarı
 * taşımaz.
 */
export const CUSTOMER_ACCOUNT_PUBLIC_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  /**
   * Yalnız kimliği çekilir; koddan/borçtan hiçbir şey taşınmaz. Gösterime
   * BOOLEAN olarak çevrilir (`hasLinkedCustomer`) — müşteri kartının varlığı
   * bile "bağlı mısınız" sorusunun ötesine geçmemeli (Kural 8).
   */
  customerId: true,
} as const satisfies Prisma.CustomerAccountSelect;

export type CustomerAccountPublicRow = Prisma.CustomerAccountGetPayload<{
  select: typeof CUSTOMER_ACCOUNT_PUBLIC_SELECT;
}>;

/** Prisma satırını dışarıya güvenli gösterime çevirir. */
export function toCustomerAccountProfile(row: CustomerAccountPublicRow): CustomerAccountProfile {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    isEmailVerified: row.emailVerifiedAt !== null,
    hasLinkedCustomer: row.customerId !== null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
