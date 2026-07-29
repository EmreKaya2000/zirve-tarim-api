import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Category } from '@prisma/client';
import type { Request } from 'express';
import type { PaginatedResult } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { SetActiveDto } from '../../common/dto/lookup.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
  type CategoryTreeNode,
} from './dto/category.dto';

/**
 * Kategori yönetimi (admin).
 *
 * Ağaç ucu burada da bulunur: yönetici PASİF kategorileri de görmelidir,
 * public uç yalnız aktifleri döndürür.
 */
@ApiTags('Katalog — Kategoriler')
@ApiBearerAuth('access-token')
@Controller('admin/categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Kategorileri listele',
    description: 'Sayfalama, arama, aktiflik, üst kategori ve yalnız-kök filtreleri destekler.',
  })
  async findMany(@Query() query: ListCategoriesQueryDto): Promise<PaginatedResult<Category>> {
    return this.service.findMany(query);
  }

  @Get('tree')
  @ApiOperation({
    summary: 'Kategori ağacı (yönetici)',
    description: 'Pasif kategoriler DAHİL tüm ağacı döner.',
  })
  async getTree(): Promise<CategoryTreeNode[]> {
    return this.service.getTree(false);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Kategori detayı' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Category> {
    return this.service.findOne(id);
  }

  @Get(':id/breadcrumb')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Kökten kategoriye kadar olan yol' })
  async getBreadcrumb(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; name: string; slug: string }[]> {
    return this.service.getBreadcrumb(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Kategori oluştur',
    description: 'Slug addan üretilir. parentId verilmezse kök kategori olur.',
  })
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Category> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kategori güncelle / taşı',
    description:
      'parentId gönderilirse kategori taşınır. Kendi alt ağacına taşıma DÖNGÜ oluşturacağı için reddedilir (422).',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Category> {
    return this.service.update(id, dto, toActor(user, request));
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Aktifleştir / pasife al',
    description: 'Pasife alınan kategorinin TÜM alt ağacı da pasife alınır.',
  })
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Category> {
    return this.service.setActive(id, dto.isActive, toActor(user, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kategori sil (soft delete)',
    description: 'Altında alt kategori varsa reddedilir (409).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, toActor(user, request));
  }
}
