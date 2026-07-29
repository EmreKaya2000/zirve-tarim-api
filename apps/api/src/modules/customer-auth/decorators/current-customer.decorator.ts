import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * CustomerJwtGuard'ın isteğe iliştirdiği müşteri bağlamı.
 *
 * `RequestUser` İLE AYRI TUTULDU ve `role` alanı YOKTUR: müşterinin rolü
 * yoktur, yetkisi kaydın sahipliğinden gelir. Tek tip kullanılsaydı
 * `user.role` okuyan bir kod müşteri isteğinde `undefined` görür ve
 * `RolesGuard` benzeri bir kontrol sessizce geçebilirdi.
 */
export interface RequestCustomer {
  id: string;
  email: string;
  /** Access token'ın jti değeri. */
  tokenId: string;
  /** E-posta doğrulandı mı? Geçmiş talep bağlama gibi akışların önkoşulu. */
  isEmailVerified: boolean;
}

interface RequestWithCustomer {
  customer?: RequestCustomer;
}

/**
 * Controller metotlarında oturum açmış MÜŞTERİYİ verir.
 *
 * @example
 * ＠Get('cart')
 * cart(＠CurrentCustomer('id') accountId: string) { ... }
 */
export const CurrentCustomer = createParamDecorator(
  (
    data: keyof RequestCustomer | undefined,
    context: ExecutionContext,
  ): RequestCustomer | unknown => {
    const request = context.switchToHttp().getRequest<RequestWithCustomer>();
    const customer = request.customer;

    if (customer === undefined) {
      // Guard global olduğu için normalde buraya düşülmez; düşülüyorsa uç
      // @Public() işaretli ama müşteri bekliyor demektir.
      return undefined;
    }

    return data === undefined ? customer : customer[data];
  },
);
