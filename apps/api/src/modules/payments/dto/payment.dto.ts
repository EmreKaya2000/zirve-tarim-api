import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PAYMENT_METHODS, type PaymentMethod } from '@zirve/types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

export class CreatePaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS, {
    message: `method yalnız şunlardan biri olabilir: ${PAYMENT_METHODS.join(', ')}.`,
  })
  method!: PaymentMethod;

  @ApiProperty({
    description: 'Ödeme tutarı. Sayısal METİN (Kural 2). Kalan borcu aşamaz.',
    example: '1500.00',
  })
  @IsNumberString({}, { message: 'amount sayısal bir metin olmalıdır.' })
  @Trim()
  amount!: string;

  @ApiProperty({ description: 'Tahsilat tarihi (ISO 8601).' })
  @IsDateString({}, { message: 'paymentDate geçerli bir tarih olmalıdır.' })
  paymentDate!: string;

  @ApiPropertyOptional({ description: 'Çek/senet vade tarihi. Bu yöntemlerde ZORUNLU.' })
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

/** Ödeme silme gövdesi — gerekçe zorunludur (Kural 4). */
export class DeletePaymentDto {
  @ApiProperty({ description: 'Silme gerekçesi. ZORUNLUDUR.', maxLength: 500 })
  @IsString()
  @IsNotEmpty({ message: 'Silme gerekçesi zorunludur.' })
  @MaxLength(500)
  @Trim()
  reason!: string;
}

export const PAYMENT_SORT_FIELDS = ['paymentDate', 'createdAt', 'amount', 'paymentNumber'] as const;

export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_SORT_FIELDS, default: 'paymentDate' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS, {
    message: `sortBy yalnız şunlardan biri olabilir: ${PAYMENT_SORT_FIELDS.join(', ')}.`,
  })
  sortBy: PaymentSortField = 'paymentDate';

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  saleId?: string;
}
