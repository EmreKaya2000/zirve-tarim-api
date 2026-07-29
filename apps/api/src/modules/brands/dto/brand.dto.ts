import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export class CreateBrandDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({ example: 'https://cdn.zirvetarim.com/markalar/agromax.webp' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoUrl geçerli bir adres olmalıdır.' })
  @MaxLength(500)
  @TrimToUndefined()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://agromax.com' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'websiteUrl geçerli bir adres olmalıdır.' })
  @MaxLength(500)
  @TrimToUndefined()
  websiteUrl?: string;

  @ApiPropertyOptional({
    example: 'Türkiye',
    description: 'Üretici ülke. Çiftçi için güven unsuru olabiliyor.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  country?: string;
}

export class UpdateBrandDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @TrimToUndefined()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @TrimToUndefined()
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @TrimToUndefined()
  country?: string;
}
