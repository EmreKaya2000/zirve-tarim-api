import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductRelationType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PRODUCT_RELATION_TYPES } from '@zirve/types';

import { TrimToUndefined } from '../../../common/dto/lookup.dto';

export class CreateRelationDto {
  @ApiProperty({ format: 'uuid', description: 'İlişkilendirilecek diğer ürün.' })
  @IsUUID('4', { message: 'targetProductId geçerli bir UUID olmalıdır.' })
  targetProductId!: string;

  @ApiProperty({
    enum: PRODUCT_RELATION_TYPES,
    description:
      'COMPATIBLE / INCOMPATIBLE / SIMILAR simetriktir (tek kayıt). ALTERNATIVE / COMPLEMENTARY / RECOMMENDED_TOGETHER yönlüdür.',
  })
  @IsEnum(ProductRelationType, { message: 'Geçersiz ilişki türü.' })
  type!: ProductRelationType;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'INCOMPATIBLE türünde ZORUNLUDUR: neden birlikte kullanılmamalı.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimToUndefined()
  note?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
