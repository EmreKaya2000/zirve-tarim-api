import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeasurementType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { LookupQueryDto } from '../../../common/dto/base-query.dto';
import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export const MEASUREMENT_TYPES = Object.values(MeasurementType);

/** Birim kodu: kısa, ASCII, küçük harf. Örn. "kg", "lt", "ad" */
const UNIT_CODE_PATTERN = /^[a-z0-9]{1,16}$/;

export class CreateUnitTypeDto extends BaseLookupCreateDto {
  @ApiProperty({
    example: 'kg',
    description: 'Kısa gösterim. Yalnız küçük harf ve rakam, en fazla 16 karakter.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(UNIT_CODE_PATTERN, {
    message: 'Birim kodu yalnız küçük harf ve rakam içerebilir (ör. kg, lt, ad).',
  })
  code!: string;

  @ApiProperty({ enum: MEASUREMENT_TYPES, example: MeasurementType.WEIGHT })
  @IsEnum(MeasurementType, { message: 'Geçersiz ölçü türü.' })
  measurementType!: MeasurementType;

  @ApiProperty({
    example: true,
    description:
      'Ondalıklı miktar girilebilir mi? "2.5 kg" geçerli, "2.5 adet" değildir. Satış ve stok doğrulaması bu alanı kullanır.',
  })
  @IsBoolean({ message: 'allowsDecimal true veya false olmalıdır.' })
  allowsDecimal!: boolean;

  @ApiPropertyOptional({
    example: '0.001',
    description:
      'Temel birime çevrim katsayısı (g -> kg için 0.001). Kesinlik kaybı olmaması için STRING taşınır.',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'conversionFactor sayısal bir metin olmalıdır (ör. "0.001").' })
  @TrimToUndefined()
  conversionFactor?: string;
}

export class UpdateUnitTypeDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({ example: 'kg' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(UNIT_CODE_PATTERN, {
    message: 'Birim kodu yalnız küçük harf ve rakam içerebilir (ör. kg, lt, ad).',
  })
  code?: string;

  @ApiPropertyOptional({ enum: MEASUREMENT_TYPES })
  @IsOptional()
  @IsEnum(MeasurementType, { message: 'Geçersiz ölçü türü.' })
  measurementType?: MeasurementType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowsDecimal?: boolean;

  @ApiPropertyOptional({ example: '0.001' })
  @IsOptional()
  @IsNumberString({}, { message: 'conversionFactor sayısal bir metin olmalıdır.' })
  @TrimToUndefined()
  conversionFactor?: string;
}

export class ListUnitTypesQueryDto extends LookupQueryDto {
  @ApiPropertyOptional({ enum: MEASUREMENT_TYPES, description: 'Ölçü türüne göre filtrele.' })
  @IsOptional()
  @IsIn(MEASUREMENT_TYPES, { message: 'Geçersiz ölçü türü filtresi.' })
  measurementType?: MeasurementType;
}
