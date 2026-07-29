import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export class CreateBenefitDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({ example: 'sprout', description: 'Lucide ikon adı.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @TrimToUndefined()
  icon?: string;
}

export class UpdateBenefitDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({ example: 'sprout', description: 'Lucide ikon adı.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @TrimToUndefined()
  icon?: string;
}
