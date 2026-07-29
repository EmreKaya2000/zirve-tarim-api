import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { SoilType } from '@prisma/client';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { SoilTypesService } from './soil-types.service';
import { CreateSoilTypeDto, UpdateSoilTypeDto } from './dto/soil-type.dto';

/**
 * Toprak Türü yönetimi (admin).
 * CRUD davranışı LookupCrudController'dan gelir.
 */
@ApiTags('Katalog — Toprak Türleri')
@ApiBearerAuth('access-token')
@Controller('admin/soil-types')
export class SoilTypesController extends LookupCrudController<
  SoilType,
  CreateSoilTypeDto,
  UpdateSoilTypeDto
> {
  constructor(protected readonly service: SoilTypesService) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Toprak türü oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateSoilTypeDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<SoilType> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Toprak türü güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSoilTypeDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<SoilType> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
