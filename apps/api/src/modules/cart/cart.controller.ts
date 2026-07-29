import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CartMergeResult, CartView } from '@zirve/types';

import { CustomerAuth } from '../auth/decorators/customer-auth.decorator';
import { CurrentCustomer } from '../customer-auth/decorators/current-customer.decorator';

import { CartService } from './cart.service';
import { AddCartItemDto, MergeCartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Sepet yazma işlemleri sık çağrılır (adımlayıcıya basma) ama her basış bir
 * istek üretir. Dakikada 60, insan hızının üstünde ve otomatik bir döngüyü
 * durdurmaya yeter.
 */
const CART_WRITE_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * Birleştirme dakikada 10 ile sınırlıdır: istemci bunu yalnız kayıt ve giriş
 * sonrasında bir kez çağırır. Daha fazlası ya hatalı bir istemci döngüsüdür
 * ya da kötüye kullanımdır.
 */
const CART_MERGE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Girişli müşterinin sepeti — Sprint 11 şartı 2.
 *
 * MİSAFİR SEPETİ BU UÇLARA GELMEZ: localStorage'da kalır (Sprint 6 akışı
 * değişmedi). İki sepet yalnız `POST merge` ile buluşur.
 */
@ApiTags('Müşteri — Sepet')
@ApiBearerAuth('customer-token')
@CustomerAuth()
@Controller('customer/cart')
export class CartController {
  constructor(private readonly service: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Sepeti getir',
    description: [
      'Ürün adı, fiyat ve miktar kuralları HER OKUMADA katalogdan güncel',
      'hâliyle gelir — sepet snapshot tutmaz. Talep gönderildiği anda snapshot',
      'alınır ve o kayıt dondurulur (Kural 5).',
      '',
      'Yayından kalkmış kalemler SİLİNMEZ, `isAvailable: false` ile işaretlenir',
      've tahmini tutara katılmaz.',
    ].join('\n'),
  })
  async get(@CurrentCustomer('id') accountId: string): Promise<CartView> {
    return this.service.getCart(accountId);
  }

  @Post('items')
  @Throttle(CART_WRITE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sepete ürün ekle',
    description: [
      'Varyasyon sepette zaten varsa MİKTARLAR TOPLANIR (localStorage sepetiyle',
      'aynı davranış).',
      '',
      'Miktar kuralları (asgari, adım, azami, ondalık) Sprint 6 ile AYNI şekilde',
      've BAĞLAYICI olarak uygulanır; ihlalde alan bazlı hata döner. Sepet',
      'uçlarında miktar sessizce düzeltilmez — yalnız birleştirmede düzeltilir.',
    ].join('\n'),
  })
  async addItem(
    @CurrentCustomer('id') accountId: string,
    @Body() dto: AddCartItemDto,
  ): Promise<CartView> {
    return this.service.addItem(accountId, dto);
  }

  @Patch('items/:id')
  @Throttle(CART_WRITE_THROTTLE)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Sepet KALEMİNİN kimliği.' })
  @ApiOperation({
    summary: 'Sepet kalemi miktarını değiştir',
    description:
      'Miktarı MUTLAK değere ayarlar (toplamaz). Başkasının kalemi 404 döner — ' +
      'kalemin var olduğu bilgisi bile sızmaz.',
  })
  async updateItem(
    @CurrentCustomer('id') accountId: string,
    @Param('id', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartView> {
    return this.service.updateItem(accountId, itemId, dto.quantity);
  }

  @Delete('items/:id')
  @Throttle(CART_WRITE_THROTTLE)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Sepet KALEMİNİN kimliği.' })
  @ApiOperation({ summary: 'Sepetten kalem çıkar' })
  async removeItem(
    @CurrentCustomer('id') accountId: string,
    @Param('id', ParseUUIDPipe) itemId: string,
  ): Promise<CartView> {
    return this.service.removeItem(accountId, itemId);
  }

  @Delete()
  @Throttle(CART_WRITE_THROTTLE)
  @ApiOperation({
    summary: 'Sepeti boşalt',
    description:
      'Tüm kalemleri siler. Birleştirme parmak izi de sıfırlanır: kullanıcı sepeti ' +
      'bilinçli boşalttıysa aynı misafir sepetini yeniden taşımak isteyebilir.',
  })
  async clear(@CurrentCustomer('id') accountId: string): Promise<CartView> {
    return this.service.clear(accountId);
  }

  @Post('merge')
  @Throttle(CART_MERGE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Misafir sepetini hesaba taşı',
    description: [
      'İstemci bunu KAYIT VE HER GİRİŞ sonrasında çağırır; gövdede',
      'localStorage sepeti gönderilir.',
      '',
      '**Kurallar**',
      '- Aynı varyasyon iki sepette de varsa miktarlar TOPLANIR.',
      '- Sonuç asgari/adım/azami kurallarına uyan EN YAKIN geçerli miktara',
      '  ayarlanır; değişen kalemler `adjustedItems` içinde döner.',
      '- Pasif, silinmiş veya yayında olmayan varyasyonlar ATLANIR ve',
      '  nedenleriyle `skippedItems` içinde döner.',
      '- **İDEMPOTENT**: aynı gövde ikinci kez gönderilirse sepet DEĞİŞMEZ.',
      '  Toplama işlemi doğası gereği idempotent olmadığı için son uygulanan',
      '  isteğin parmak izi sepette saklanır ve tekrar tespit edilir.',
      '',
      'Boş liste geçerlidir: yalnız sunucu sepetini döndürür.',
      '',
      'İstemci başarılı yanıttan SONRA yerel sepeti temizlemelidir.',
    ].join('\n'),
  })
  async merge(
    @CurrentCustomer('id') accountId: string,
    @Body() dto: MergeCartDto,
  ): Promise<CartMergeResult> {
    return this.service.merge(accountId, dto.items);
  }
}
