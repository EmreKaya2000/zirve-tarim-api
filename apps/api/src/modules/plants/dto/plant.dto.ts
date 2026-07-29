import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export class CreatePlantDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({
    example: 'Triticum aestivum',
    description: 'Latince adı. Ziraat mühendisleri için anlamlıdır.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @TrimToUndefined()
  latinName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zirvetarim.com/bitkiler/bugday.webp' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'imageUrl geçerli bir adres olmalıdır.' })
  @MaxLength(500)
  @TrimToUndefined()
  imageUrl?: string;
}

export class UpdatePlantDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({ example: 'Triticum aestivum' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @TrimToUndefined()
  latinName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @TrimToUndefined()
  imageUrl?: string;
}
