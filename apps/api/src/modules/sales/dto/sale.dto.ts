import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ADDITIONAL_COST_TYPES,
  MAX_SALE_ITEMS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  SALE_STATUSES,
  type AdditionalCostType,
  type PaymentMethod,
  type PaymentType,
} from '@zirve/types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

export class SaleItemInputDto {
  @ApiProperty({ description: 'Varyasyon kimliği.', format: 'uuid' })
  @IsUUID('4', { message: 'variantId geçerli bir kimlik olmalıdır.' })
  variantId!: string;

  @ApiProperty({ description: 'Miktar. Sayısal METİN (Kural 2).', example: '50' })
  @IsNumberString({}, { message: 'quantity sayısal bir metin olmalıdır.' })
  @Trim()
  quantity!: string;

  @ApiPropertyOptional({
    description: [
      'Birim satış fiyatı. Verilmezse varyasyonun O ANKİ satış fiyatı kullanılır.',
      'Verildiğinde pazarlık sonucu fiyat uygulanabilir.',
    ].join(' '),
    example: '600.00',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'unitSalePrice sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  unitSalePrice?: string;

  @ApiPropertyOptional({ description: 'Satır indirim TUTARI (yüzde değil).', example: '50.00' })
  @IsOptional()
  @IsNumberString({}, { message: 'discountAmount sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  discountAmount?: string;
}

/** Satışla birlikte alınan ilk ödeme (peşin satışta yaygın). */
export class InitialPaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS, {
    message: `method yalnız şunlardan biri olabilir: ${PAYMENT_METHODS.join(', ')}.`,
  })
  method!: PaymentMethod;

  @ApiProperty({ description: 'Ödeme tutarı.', example: '1000.00' })
  @IsNumberString({}, { message: 'amount sayısal bir metin olmalıdır.' })
  @Trim()
  amount!: string;

  @ApiPropertyOptional({ description: 'Çek/senet vade tarihi (bu yöntemlerde ZORUNLU).' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate geçerli bir tarih olmalıdır.' })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Çek numarası, havale referansı vb.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @TrimToUndefined()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;
}

export class CreateSaleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'customerId geçerli bir kimlik olmalıdır.' })
  customerId!: string;

  @ApiProperty({ description: 'Satış tarihi (ISO 8601).' })
  @IsDateString({}, { message: 'saleDate geçerli bir tarih olmalıdır.' })
  saleDate!: string;

  @ApiProperty({ enum: PAYMENT_TYPES, default: 'CASH' })
  @IsIn(PAYMENT_TYPES, {
    message: `paymentType yalnız şunlardan biri olabilir: ${PAYMENT_TYPES.join(', ')}.`,
  })
  paymentType: PaymentType = 'CASH';

  @ApiPropertyOptional({ description: 'Vadeli satışta ZORUNLU.' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate geçerli bir tarih olmalıdır.' })
  dueDate?: string;

  @ApiProperty({ type: [SaleItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Satış en az bir kalem içermelidir.' })
  @ArrayMaxSize(MAX_SALE_ITEMS, {
    message: `Bir satışta en fazla ${MAX_SALE_ITEMS} kalem olabilir.`,
  })
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items!: SaleItemInputDto[];

  @ApiPropertyOptional({ type: InitialPaymentDto, description: 'Satışla birlikte alınan ödeme.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialPaymentDto)
  initialPayment?: InitialPaymentDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;
}

/**
 * Satış güncelleme.
 *
 * YALNIZ DRAFT durumunda kullanılabilir (servis katmanı denetler).
 * `items` gönderildiyse kalemler TAMAMEN değiştirilir: kısmi kalem
 * güncelleme uçları yoktur, "gönderilen liste = son durum" sözleşmesi
 * formun davranışıyla birebir örtüşür.
 */
export class UpdateSaleDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'saleDate geçerli bir tarih olmalıdır.' })
  saleDate?: string;

  @ApiPropertyOptional({ enum: PAYMENT_TYPES })
  @IsOptional()
  @IsIn(PAYMENT_TYPES)
  paymentType?: PaymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'dueDate geçerli bir tarih olmalıdır.' })
  dueDate?: string;

  @ApiPropertyOptional({ type: [SaleItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Satış en az bir kalem içermelidir.' })
  @ArrayMaxSize(MAX_SALE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items?: SaleItemInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  note?: string;
}

export class CancelSaleDto {
  @ApiProperty({ description: 'İptal nedeni. ZORUNLUDUR.', maxLength: 500 })
  @IsString()
  @IsNotEmpty({ message: 'İptal nedeni zorunludur.' })
  @MaxLength(500)
  @Trim()
  reason!: string;
}

export class AddAdditionalCostDto {
  @ApiProperty({ enum: ADDITIONAL_COST_TYPES })
  @IsIn(ADDITIONAL_COST_TYPES, {
    message: `costType yalnız şunlardan biri olabilir: ${ADDITIONAL_COST_TYPES.join(', ')}.`,
  })
  costType!: AdditionalCostType;

  @ApiProperty({ description: 'Tutar (sıfırdan büyük).', example: '250.00' })
  @IsNumberString({}, { message: 'amount sayısal bir metin olmalıdır.' })
  @Trim()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @TrimToUndefined()
  description?: string;
}

export const SALE_SORT_FIELDS = [
  'saleDate',
  'createdAt',
  'saleNumber',
  'grandTotal',
  'remainingTotal',
  'status',
] as const;

export type SaleSortField = (typeof SALE_SORT_FIELDS)[number];

export class SaleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SALE_SORT_FIELDS, default: 'saleDate' })
  @IsOptional()
  @IsIn(SALE_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${SALE_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: SaleSortField = 'saleDate';

  @ApiPropertyOptional({ enum: SALE_STATUSES, description: 'Virgülle çoklu durum.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional({ enum: PAYMENT_TYPES })
  @IsOptional()
  @IsIn(PAYMENT_TYPES)
  paymentType?: PaymentType;

  @ApiPropertyOptional({ description: 'Yalnız vadesi geçmiş ve borcu kalan satışlar.' })
  @IsOptional()
  @IsIn(['1'], { message: 'overdue yalnız "1" olabilir.' })
  overdue?: string;
}
