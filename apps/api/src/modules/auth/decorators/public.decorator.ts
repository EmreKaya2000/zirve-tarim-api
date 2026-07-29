import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Bir ucu kimlik doğrulamasından muaf tutar.
 *
 * JwtAuthGuard GLOBAL olduğu için varsayılan davranış "korumalı"dır
 * (güvenli varsayılan): yeni bir uç yazan geliştirici unutarak korumasız
 * uç açamaz — muafiyet bilinçli olarak bu dekoratörle istenir.
 *
 * docs/ARCHITECTURE.md §8.3
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
