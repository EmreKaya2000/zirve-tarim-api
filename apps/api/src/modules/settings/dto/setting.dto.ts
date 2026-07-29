import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SETTING_GROUPS, SETTING_VALUE_TYPES, type SettingValueType } from '@zirve/types';

import { Trim, TrimToUndefined } from '../../../common/dto/lookup.dto';

/**
 * Ayar güncelleme.
 *
 * `key` DEĞİŞTİRİLEMEZ: kod içinde sabit olarak referans verilir
 * (SETTING_KEYS). Anahtarın değişmesi sessizce kırılmaya yol açar.
 * Yeni ayar eklemek migration/seed işidir, çalışma zamanı işlemi değil.
 */
export class UpdateSettingDto {
  @ApiProperty({ description: 'Ayarın yeni değeri. Tip dönüşümü valueType ile yapılır.' })
  @IsString()
  @MaxLength(20_000, { message: 'Ayar değeri en fazla 20.000 karakter olabilir.' })
  @Trim()
  value!: string;

  @ApiPropertyOptional({ description: 'Yönetici panelinde gösterilecek açıklama.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @TrimToUndefined()
  description?: string;
}

/** Toplu güncelleme için tek kalem. */
export class SettingUpdateItemDto {
  @ApiProperty({ example: 'store.phone' })
  @IsString()
  @MaxLength(120)
  @Trim()
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  value!: string;
}

export class ListSettingsQueryDto {
  @ApiPropertyOptional({ enum: SETTING_GROUPS, description: 'Gruba göre filtrele.' })
  @IsOptional()
  @IsIn(SETTING_GROUPS, { message: 'Geçersiz ayar grubu.' })
  group?: string;

  @ApiPropertyOptional({ description: 'Anahtar veya açıklamada arama.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  search?: string;
}

/** Swagger yanıt modeli. */
export class SettingResponseDto {
  @ApiProperty({ example: 'store.phone' })
  key!: string;

  @ApiProperty({ example: '+90 555 000 00 00' })
  value!: string;

  @ApiProperty({ enum: SETTING_VALUE_TYPES, example: 'string' })
  valueType!: SettingValueType;

  @ApiProperty({ example: 'store' })
  group!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ example: true })
  isPublic!: boolean;
}
