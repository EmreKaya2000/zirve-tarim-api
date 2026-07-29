import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Brand } from '@prisma/client';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@ApiTags('Katalog — Markalar')
@ApiBearerAuth('access-token')
@Controller('admin/brands')
export class BrandsController extends LookupCrudController<Brand, CreateBrandDto, UpdateBrandDto> {
  constructor(protected readonly service: BrandsService) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Marka oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateBrandDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Brand> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Marka güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Brand> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
