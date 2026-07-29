import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_CUSTOMER_ROUTE_KEY = 'isCustomerRoute';

/**
 * Ucu PUBLIC MÜŞTERİ HESABINA ait olarak işaretler (Sprint 11).
 *
 * Etkisi üç guard üzerindedir (hepsi global — docs/ARCHITECTURE.md §8.3):
 *   JwtAuthGuard     : atlanır (yönetici jetonu aranmaz)
 *   RolesGuard       : atlanır (müşterinin `role` alanı yoktur)
 *   CustomerJwtGuard : DEVREYE GİRER; `aud: zirve-customer` taşıyan geçerli
 *                      bir jeton ister ve `request.customer`ı doldurur.
 *
 * `@Public()` bu işareti EZER: aynı denetleyicideki kayıt/giriş uçları
 * kimlik istemez.
 *
 * GÜVENLİ VARSAYILAN: işareti koymayı unutan bir müşteri denetleyicisi
 * yönetici jetonu ister ve müşteriye 401 döner. Yanlış yönde başarısız olur —
 * yetkisiz erişim değil, erişememe üretir.
 *
 * @example
 * ＠CustomerAuth()
 * ＠Controller('customer/cart')
 * export class CartController { ... }
 */
export const CustomerAuth = (): CustomDecorator<string> => SetMetadata(IS_CUSTOMER_ROUTE_KEY, true);
