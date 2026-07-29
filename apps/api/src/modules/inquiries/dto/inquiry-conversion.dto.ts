import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_SALE_ITEMS, PAYMENT_TYPES, type PaymentType } from '@zirve/types';

import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/** Dönüşümde kalem düzenlemesi. */
export class ConvertInquiryItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'variantId geçerli bir kimlik olmalıdır.' })
  variantId!: string;

  @ApiProperty({ description: 'Satılacak miktar. Talepteki miktardan farklı olabilir.' })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @Trim()
  quantity!: string;

  @ApiPropertyOptional({
    description: 'Birim satış fiyatı. Verilmezse varyasyonun güncel fiyatı kullanılır.',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'unitSalePrice sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  unitSalePrice?: string;

  @ApiPropertyOptional({ description: 'Satır indirim tutarı.' })
  @IsOptional()
  @IsNumberString({}, { message: 'discountAmount sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  discountAmount?: string;
}

/**
 * Talep -> satış dönüşüm gövdesi.
 *
 * `customerId` verilmezse talebin telefon numarasıyla kayıtlı müşteri
 * aranır; yoksa talebin iletişim bilgilerinden YENİ müşteri oluşturulur.
 */
export class ConvertInquiryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mevcut müşteri. Verilmezse telefona göre eşleştirilir veya yeni oluşturulur.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'customerId geçerli bir kimlik olmalıdır.' })
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Yeni müşteri oluşturulacaksa ad soyad. Verilmezse talepteki ad kullanılır.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Ad soyad en az 3 karakter olmalıdır.' })
  @MaxLength(200)
  @TrimToUndefined()
  newCustomerName?: string;

  @ApiProperty({ enum: PAYMENT_TYPES, default: 'CASH' })
  @IsIn(PAYMENT_TYPES, {
    message: `paymentType yalnız şunlardan biri olabilir: ${PAYMENT_TYPES.join(', ')}.`,
  })
  paymentType: PaymentType = 'CASH';

  @ApiPropertyOptional({ description: 'Vadeli satışta ZORUNLU.' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate geçerli bir tarih olmalıdır.' })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Satış tarihi. Verilmezse şimdi.' })
  @IsOptional()
  @IsDateString({}, { message: 'saleDate geçerli bir tarih olmalıdır.' })
  saleDate?: string;

  @ApiPropertyOptional({
    type: [ConvertInquiryItemDto],
    description: 'Verilmezse talep kalemleri olduğu gibi aktarılır.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SALE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ConvertInquiryItemDto)
  items?: ConvertInquiryItemDto[];

  @ApiPropertyOptional({ description: 'Satış notu. Verilmezse talebin müşteri notu taşınır.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;
}
