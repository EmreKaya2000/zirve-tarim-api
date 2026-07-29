import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { CustomerContextService } from '../customer-auth/customer-context.service';

import { InquiriesService } from './inquiries.service';
import { CreateInquiryDto, ValidateCartDto } from './dto/inquiry.dto';

/**
 * Talep gönderme sınırı.
 *
 * Saatte 5 talep, tek IP için. Gerçek bir çiftçi bir oturumda en fazla
 * bir-iki talep gönderir; daha fazlası ya hata ya kötüye kullanımdır.
 * Sınır, mağazanın gerçek talepleri sahte kayıtlar arasında aramasını
 * önlemek için var.
 */
export const CREATE_THROTTLE = { default: { limit: 5, ttl: 3_600_000 } };

/** Sepet doğrulama daha sık çağrılır: her sepet açılışında bir kez. */
export const VALIDATE_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('Public — Talep')
@Public()
@Controller('public')
export class PublicInquiriesController {
  constructor(
    private readonly inquiries: InquiriesService,
    private readonly customerContext: CustomerContextService,
  ) {}

  @Post('cart/validate')
  @HttpCode(HttpStatus.OK)
  @Throttle(VALIDATE_THROTTLE)
  @ApiOperation({
    summary: 'Sepeti doğrula',
    description: [
      'Talep GÖNDERMEDEN önce sepeti kontrol eder: ürün hâlâ yayında mı,',
      'varyasyon aktif mi, miktar asgari/adım kurallarına uyuyor mu.',
      '',
      'Hatalar alan bazında `error.details` içinde döner:',
      '`{ field: "items[2].quantity", message: "..." }`.',
      '',
      'NOT: Talep stok REZERVE ETMEZ. Stok bilgisi yanıtta yalnız',
      'bilgilendirme amacıyla bulunur; yetersiz stok hata değildir.',
    ].join('\n'),
  })
  async validateCart(@Body() dto: ValidateCartDto) {
    return this.inquiries.validateCart(dto.items);
  }

  @Post('inquiries')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(CREATE_THROTTLE)
  @ApiOperation({
    summary: 'Talep gönder',
    description: [
      'Sepeti mağazaya iletilen bir talebe dönüştürür.',
      '',
      'BU BİR SİPARİŞ DEĞİLDİR: stok rezerve edilmez, fiyat garantisi',
      'verilmez, ödeme alınmaz (docs/ARCHITECTURE.md Ç-01).',
      '',
      '`consentAccepted` true DEĞİLSE talep reddedilir (KVKK).',
      '',
      '**MİSAFİR VE GİRİŞLİ KULLANICI AYNI UCU KULLANIR** (Sprint 11):',
      'geçerli bir müşteri jetonu gönderilirse talep otomatik olarak o hesaba',
      'bağlanır ve "Taleplerim" sayfasında görünür. Jeton yoksa veya',
      'geçersizse talep MİSAFİR talebi olarak kaydedilir — Sprint 6 akışı',
      'aynen çalışır.',
      '',
      'Hesap bağı GÖVDEDEN ALINMAZ, jetondan çözülür: aksi hâlde herkes',
      'talebini başkasının hesabına yazabilirdi.',
    ].join('\n'),
  })
  async create(@Body() dto: CreateInquiryDto, @Req() request: Request) {
    // Geçersiz/süresi dolmuş jeton isteği DÜŞÜRMEZ; misafir olarak devam
    // edilir (gerekçe: CustomerContextService).
    const customer = await this.customerContext.resolveOptional(request);

    return this.inquiries.create(dto, {
      // `trust proxy` ayarlı olduğu için gerçek istemci IP'si okunur
      // (main.ts). Reverse proxy arkasında aksi hâlde hep proxy IP'si
      // görünür ve rate limit tüm ziyaretçileri tek kovaya koyardı.
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
      ...(customer !== null && { customerAccountId: customer.id }),
    });
  }
}
