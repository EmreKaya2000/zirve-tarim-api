import { ApiPropertyOptional } from '@nestjs/swagger';
import { SideEffectSeverity } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { LookupQueryDto } from '../../../common/dto/base-query.dto';
import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

/** Enum değerleri Swagger ve doğrulama için dizi olarak. */
export const SIDE_EFFECT_SEVERITIES = Object.values(SideEffectSeverity);

export class CreateSideEffectDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({
    enum: SIDE_EFFECT_SEVERITIES,
    default: SideEffectSeverity.LOW,
    description: 'Ciddiyet seviyesi. Ürün detayındaki uyarı rengini belirler.',
  })
  @IsOptional()
  @IsEnum(SideEffectSeverity, { message: 'Geçersiz ciddiyet seviyesi.' })
  severity?: SideEffectSeverity;

  @ApiPropertyOptional({
    example: 'Uygulama sırasında eldiven ve maske kullanın.',
    description: 'Alınması gereken önlem. Ürün detayında uyarı olarak gösterilir.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  precaution?: string;
}

export class UpdateSideEffectDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({ enum: SIDE_EFFECT_SEVERITIES })
  @IsOptional()
  @IsEnum(SideEffectSeverity, { message: 'Geçersiz ciddiyet seviyesi.' })
  severity?: SideEffectSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimToUndefined()
  precaution?: string;
}

/** Yan etki listesi: ciddiyete göre de filtrelenebilir. */
export class ListSideEffectsQueryDto extends LookupQueryDto {
  @ApiPropertyOptional({
    enum: SIDE_EFFECT_SEVERITIES,
    description: 'Ciddiyet seviyesine göre filtrele.',
  })
  @IsOptional()
  @IsIn(SIDE_EFFECT_SEVERITIES, { message: 'Geçersiz ciddiyet filtresi.' })
  severity?: SideEffectSeverity;
}
