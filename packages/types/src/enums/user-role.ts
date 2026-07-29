/**
 * Yönetim paneli rolleri — docs/ARCHITECTURE.md §8.
 *
 * MVP'de yalnızca SUPER_ADMIN ve ADMIN kullanılır; diğerleri ileride personel
 * ayrımı gerektiğinde migration'a gerek kalmasın diye enum'da yer alır.
 *
 * Prisma'daki `UserRole` enum'u ile BİREBİR aynı olmalıdır.
 */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'SALES_STAFF',
  'WAREHOUSE_STAFF',
  'ACCOUNTANT',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** MVP'de gerçekten kullanılan roller. Kullanıcı oluşturma formu bunları listeler. */
export const ACTIVE_USER_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const satisfies readonly UserRole[];

export type ActiveUserRole = (typeof ACTIVE_USER_ROLES)[number];

/** Kullanıcıya gösterilecek rol adları. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Süper Yönetici',
  ADMIN: 'Yönetici',
  MANAGER: 'Müdür',
  SALES_STAFF: 'Satış Personeli',
  WAREHOUSE_STAFF: 'Depo Personeli',
  ACCOUNTANT: 'Muhasebe',
};

/** Rolün kısa açıklaması — kullanıcı oluşturma formunda gösterilir. */
export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Tüm yetkiler. Kullanıcı yönetimi, iptaller, stok düzeltme, ayarlar.',
  ADMIN: 'Günlük operasyon: katalog, talep, satış, tahsilat, alış.',
  MANAGER: 'Ekip ve şube sorumlusu. (MVP kapsamı dışında)',
  SALES_STAFF: 'Yalnız satış işlemleri. (MVP kapsamı dışında)',
  WAREHOUSE_STAFF: 'Yalnız stok işlemleri. (MVP kapsamı dışında)',
  ACCOUNTANT: 'Finansal raporlara okuma erişimi. (MVP kapsamı dışında)',
};

/** Verilen değer geçerli bir rol mü? */
export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** Rol MVP'de aktif olarak kullanılıyor mu? */
export function isActiveUserRole(value: string): value is ActiveUserRole {
  return (ACTIVE_USER_ROLES as readonly string[]).includes(value);
}
