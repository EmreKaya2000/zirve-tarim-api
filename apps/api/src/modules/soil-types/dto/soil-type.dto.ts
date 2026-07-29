import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export class CreateSoilTypeDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({ example: '6.5 - 7.5', description: 'Tipik pH aralığı.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @TrimToUndefined()
  phRange?: string;
}

export class UpdateSoilTypeDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({ example: '6.5 - 7.5', description: 'Tipik pH aralığı.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @TrimToUndefined()
  phRange?: string;
}
