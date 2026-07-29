import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

import { LookupQueryDto } from '../../../common/dto/base-query.dto';
import {
  BaseLookupCreateDto,
  BaseLookupUpdateDto,
  TrimToUndefined,
} from '../../../common/dto/lookup.dto';

export class CreateCategoryDto extends BaseLookupCreateDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Üst kategori. Verilmezse kök kategori olur.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'parentId geçerli bir UUID olmalıdır.' })
  parentId?: string;

  @ApiPropertyOptional({ example: 'sprout', description: 'Lucide ikon adı.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @TrimToUndefined()
  icon?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zirvetarim.com/kategoriler/gubre.webp' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'imageUrl geçerli bir adres olmalıdır.' })
  @MaxLength(500)
  @TrimToUndefined()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'SEO başlığı.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  metaTitle?: string;

  @ApiPropertyOptional({ description: 'SEO açıklaması.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @TrimToUndefined()
  metaDesc?: string;
}

export class UpdateCategoryDto extends BaseLookupUpdateDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Yeni üst kategori. `null` gönderilirse kategori köke taşınır. Döngü oluşturacak taşımalar reddedilir.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'parentId geçerli bir UUID olmalıdır.' })
  parentId?: string | null;

  @ApiPropertyOptional({ example: 'sprout' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @TrimToUndefined()
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @TrimToUndefined()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimToUndefined()
  metaTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @TrimToUndefined()
  metaDesc?: string;
}

export class ListCategoriesQueryDto extends LookupQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Yalnız bu kategorinin doğrudan alt kategorilerini getirir.',
  })
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @ApiPropertyOptional({
    description: 'true ise yalnız kök kategoriler (üst kategorisi olmayanlar) döner.',
  })
  @IsOptional()
  @IsString()
  rootOnly?: string;
}

/** Ağaç düğümü — GET /categories/tree yanıtı. */
export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Kök için 0, her alt seviyede bir artar. */
  depth: number;
  children: CategoryTreeNode[];
}
