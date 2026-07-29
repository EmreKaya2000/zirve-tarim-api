import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  INQUIRY_STATUSES,
  MAX_INQUIRY_ITEMS,
  PREFERRED_CONTACTS,
  type InquiryStatus,
  type PreferredContact,
} from '@zirve/types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * Türk telefon numarası biçimi.
 *
 * Kabul edilen: 05321234567, 0532 123 45 67, +905321234567, 905321234567.
 * Normalleştirme servis katmanında yapılır; burada yalnız biçim doğrulanır.
 *
 * NEDEN GEVŞEK: çiftçi numarasını boşluklu, tireli veya ülke koduyla
 * yazabilir. Katı bir desen, geçerli bir numarayı reddedip talebi
 * kaybettirirdi.
 */
const PHONE_PATTERN = /^(\+?90[\s-]?)?0?[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/;

export class InquiryItemInputDto {
  @ApiProperty({ description: 'Varyasyon kimliği.', format: 'uuid' })
  @IsUUID('4', { message: 'variantId geçerli bir kimlik olmalıdır.' })
  variantId!: string;

  @ApiProperty({
    description: 'Talep edilen miktar. Sayısal METİN olarak gönderilir (Kural 2).',
    example: '10',
  })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  quantity!: string;

  @ApiPropertyOptional({ description: 'Kaleme özel not.', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @TrimToUndefined()
  note?: string;
}

/**
 * Public talep oluşturma gövdesi (SPEC §6.2).
 *
 * Kural 10: buradaki her doğrulama BAĞLAYICIDIR. Arayüzdeki aynı kurallar
 * yalnız kullanıcı deneyimi içindir; bu sınıf atlanamaz.
 */
export class CreateInquiryDto {
  @ApiProperty({ description: 'Ad soyad.', example: 'Ahmet Yılmaz' })
  @IsString()
  @IsNotEmpty({ message: 'Ad soyad zorunludur.' })
  @MinLength(3, { message: 'Ad soyad en az 3 karakter olmalıdır.' })
  @MaxLength(200)
  @Trim()
  contactName!: string;

  @ApiProperty({ description: 'Telefon numarası.', example: '0532 123 45 67' })
  @IsString()
  @IsNotEmpty({ message: 'Telefon numarası zorunludur.' })
  @Matches(PHONE_PATTERN, {
    message: 'Telefon numarası geçerli bir Türkiye cep numarası olmalıdır.',
  })
  @Trim()
  contactPhone!: string;

  @ApiPropertyOptional({ description: 'E-posta (isteğe bağlı).' })
  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi giriniz.' })
  @MaxLength(255)
  @TrimToUndefined()
  contactEmail?: string;

  @ApiProperty({ description: 'İl.', example: 'Konya' })
  @IsString()
  @IsNotEmpty({ message: 'İl zorunludur.' })
  @MaxLength(80)
  @Trim()
  city!: string;

  @ApiProperty({ description: 'İlçe.', example: 'Çumra' })
  @IsString()
  @IsNotEmpty({ message: 'İlçe zorunludur.' })
  @MaxLength(80)
  @Trim()
  district!: string;

  @ApiPropertyOptional({ description: 'Açık adres (isteğe bağlı).', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  address?: string;

  @ApiPropertyOptional({ description: 'Talebe eklenen not.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  customerNote?: string;

  @ApiProperty({ enum: PREFERRED_CONTACTS, default: 'PHONE' })
  @IsIn(PREFERRED_CONTACTS, {
    message: `preferredContact yalnız şunlardan biri olabilir: ${PREFERRED_CONTACTS.join(', ')}.`,
  })
  preferredContact: PreferredContact = 'PHONE';

  @ApiProperty({
    description: 'KVKK aydınlatma metni onayı. `true` DEĞİLSE talep reddedilir.',
    example: true,
  })
  @IsBoolean({ message: 'consentAccepted mantıksal bir değer olmalıdır.' })
  consentAccepted!: boolean;

  @ApiProperty({ type: [InquiryItemInputDto], description: 'Talep kalemleri.' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Talep en az bir ürün içermelidir.' })
  @ArrayMaxSize(MAX_INQUIRY_ITEMS, {
    message: `Bir talepte en fazla ${MAX_INQUIRY_ITEMS} ürün olabilir.`,
  })
  @ValidateNested({ each: true })
  @Type(() => InquiryItemInputDto)
  items!: InquiryItemInputDto[];
}

/** Sepet doğrulama gövdesi — talep oluşturmadan önce ön kontrol. */
export class ValidateCartDto {
  @ApiProperty({ type: [InquiryItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Sepet boş olamaz.' })
  @ArrayMaxSize(MAX_INQUIRY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => InquiryItemInputDto)
  items!: InquiryItemInputDto[];
}

/** Sıralanabilir alanlar (K-74: serbest alan adı kabul edilmez). */
export const INQUIRY_SORT_FIELDS = [
  'createdAt',
  'inquiryNumber',
  'status',
  'estimatedTotal',
] as const;

export type InquirySortField = (typeof INQUIRY_SORT_FIELDS)[number];

/**
 * Yönetim listesi filtreleri.
 *
 * `search`, `sortOrder`, `dateFrom` ve `dateTo` PaginationQueryDto'dan
 * miras alınır; burada yalnız taleple ilgili alanlar tanımlanır.
 */
export class InquiryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INQUIRY_STATUSES, description: 'Virgülle çoklu durum.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  status?: string;

  @ApiPropertyOptional({ enum: INQUIRY_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(INQUIRY_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${INQUIRY_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: InquirySortField = 'createdAt';
}

/**
 * Talep güncelleme gövdesi — şimdilik yalnız müşteri eşleştirme.
 *
 * Talebin İÇERİĞİ (kalemler, iletişim bilgileri) bilinçli olarak
 * düzenlenemez: talep müşterinin kendi beyanıdır, sonradan değiştirilmesi
 * "müşteri bunu istemişti" kaydını güvenilmez kılar. Değişiklik gerekiyorsa
 * satışa dönüşümde miktar/fiyat düzenlenir.
 */
export class UpdateInquiryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Talebi mevcut bir müşteriye bağlar. `null` gönderilirse bağ KALDIRILIR ' +
      '(yanlış müşteriye bağlanan talep düzeltilebilmelidir).',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'customerId geçerli bir kimlik olmalıdır.' })
  customerId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Talebi bir PUBLIC MÜŞTERİ HESABINA bağlar (Sprint 11 şartı 3). `null` bağı kaldırır. ' +
      'Bu, otomatik yapılmayan telefon eşleşmesi durumunda yöneticinin elle kurduğu bağdır: ' +
      'talep sahibi "sitede gönderdim ama Taleplerim\'de görmüyorum" dediğinde kullanılır. ' +
      '`customerId` (CRM kartı) alanından FARKLIDIR; ikisi bağımsızdır.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'customerAccountId geçerli bir kimlik olmalıdır.' })
  customerAccountId?: string | null;
}

/** Durum değiştirme gövdesi. */
export class UpdateInquiryStatusDto {
  @ApiProperty({ enum: INQUIRY_STATUSES })
  @IsIn(INQUIRY_STATUSES, {
    message: `status yalnız şunlardan biri olabilir: ${INQUIRY_STATUSES.join(', ')}.`,
  })
  status!: InquiryStatus;

  @ApiPropertyOptional({
    description: 'Değişiklik gerekçesi. İPTAL ve RED için ZORUNLUDUR.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  note?: string;

  @ApiPropertyOptional({ description: 'Yalnız yöneticinin gördüğü not.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  internalNote?: string;
}
