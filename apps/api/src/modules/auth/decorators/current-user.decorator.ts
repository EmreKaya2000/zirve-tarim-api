import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@zirve/types';

/**
 * JwtAuthGuard'ın isteğe iliştirdiği kullanıcı bağlamı.
 * Yalnızca jetondan gelen ve DB'den doğrulanan alanları içerir.
 */
export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  /** Access token'ın jti değeri — çıkış ve iptal takibi için. */
  tokenId: string;
}

interface RequestWithUser {
  user?: RequestUser;
}

/**
 * Controller metotlarında oturum açmış kullanıcıyı verir.
 *
 * @example
 * ＠Get('me')
 * me(＠CurrentUser() user: RequestUser) { ... }
 *
 * @example Tek bir alan
 * ＠CurrentUser('id') userId: string
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, context: ExecutionContext): RequestUser | unknown => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (user === undefined) {
      // Guard'lar global olduğu için normalde buraya düşülmez; düşülüyorsa
      // uç @Public() işaretli ama kullanıcı bekliyor demektir.
      return undefined;
    }

    return data === undefined ? user : user[data];
  },
);
