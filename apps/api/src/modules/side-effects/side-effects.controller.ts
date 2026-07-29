import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { SideEffect } from '@prisma/client';
import type { PaginatedResult } from '@zirve/types';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { SideEffectsService } from './side-effects.service';
import {
  CreateSideEffectDto,
  ListSideEffectsQueryDto,
  UpdateSideEffectDto,
} from './dto/side-effect.dto';

/**
 * Yan etki yönetimi (admin).
 *
 * `findMany` ezilir: bu modül ciddiyet filtresini de destekler ve
 * Swagger'da doğru sorgu tipini göstermek için kendi DTO'sunu kullanır.
 */
@ApiTags('Katalog — Yan Etkiler')
@ApiBearerAuth('access-token')
@Controller('admin/side-effects')
export class SideEffectsController extends LookupCrudController<
  SideEffect,
  CreateSideEffectDto,
  UpdateSideEffectDto
> {
  constructor(protected readonly service: SideEffectsService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: 'Yan etkileri listele',
    description: 'Sayfalama, arama, aktiflik ve CİDDİYET filtresi destekler.',
  })
  override async findMany(
    @Query() query: ListSideEffectsQueryDto,
  ): Promise<PaginatedResult<SideEffect>> {
    return this.service.findMany(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Yan etki oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateSideEffectDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<SideEffect> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Yan etki güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSideEffectDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<SideEffect> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
