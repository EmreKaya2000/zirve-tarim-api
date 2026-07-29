import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumberString, IsUUID, ValidateNested } from 'class-validator';
import { MAX_INQUIRY_ITEMS } from '@zirve/types';

import { TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * Sepetteki en fazla farklı kalem sayısı.
 *
 * Talep sınırıyla (`MAX_INQUIRY_ITEMS`) AYNI olmalıdır: sepet sonunda talebe
 * dönüşür. Sepet daha büyük olsaydı kullanıcı 60 kalem toplayıp gönderim
 * anında "en fazla 50 olabilir" duvarına çarpardı.
 */
export const MAX_CART_ITEMS = MAX_INQUIRY_ITEMS;

export class CartItemInputDto {
  @ApiProperty({ description: 'Varyasyon kimliği.', format: 'uuid' })
  @IsUUID('4', { message: 'productVariantId geçerli bir kimlik olmalıdır.' })
  productVariantId!: string;

  @ApiProperty({
    description: 'Miktar. Sayısal METİN olarak gönderilir (Kural 2 — float kullanılmaz).',
    example: '10',
  })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  quantity!: string;
}

/** POST /customer/cart/items */
export class AddCartItemDto extends CartItemInputDto {}

/**
 * PATCH /customer/cart/items/:id
 *
 * Yalnız miktar değiştirilebilir. Varyasyonu değiştirmek "kalemi sil, yenisini
 * ekle" demektir ve o iki ayrı işlemdir; tek uçta birleştirmek `unique(cartId,
 * productVariantId)` kısıtıyla çakışma yönetimini de buraya taşırdı.
 */
export class UpdateCartItemDto {
  @ApiProperty({ description: 'Yeni miktar (sayısal metin).', example: '15' })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  quantity!: string;
}

/**
 * POST /customer/cart/merge
 *
 * Boş liste GEÇERLİDİR ve hata değildir: istemci her girişte birleştirme
 * çağırır, misafir sepeti boşsa yapılacak iş yoktur ama sunucu sepeti yine
 * yanıtta döner (istemci tek istekle senkronlanır).
 */
export class MergeCartDto {
  @ApiProperty({
    type: [CartItemInputDto],
    description: 'localStorage sepetindeki kalemler. Boş olabilir.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_CART_ITEMS, {
    message: `Sepette en fazla ${MAX_CART_ITEMS} ürün olabilir.`,
  })
  @ValidateNested({ each: true })
  @Type(() => CartItemInputDto)
  items!: CartItemInputDto[];
}
