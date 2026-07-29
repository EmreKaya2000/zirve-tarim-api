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
import type { UnitType } from '@prisma/client';
import type { PaginatedResult } from '@zirve/types';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { UnitTypesService } from './unit-types.service';
import { CreateUnitTypeDto, ListUnitTypesQueryDto, UpdateUnitTypeDto } from './dto/unit-type.dto';

@ApiTags('Katalog — Birimler')
@ApiBearerAuth('access-token')
@Controller('admin/unit-types')
export class UnitTypesController extends LookupCrudController<
  UnitType,
  CreateUnitTypeDto,
  UpdateUnitTypeDto
> {
  constructor(protected readonly service: UnitTypesService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: 'Birimleri listele',
    description: 'Sayfalama, arama, aktiflik ve ÖLÇÜ TÜRÜ filtresi destekler.',
  })
  override async findMany(
    @Query() query: ListUnitTypesQueryDto,
  ): Promise<PaginatedResult<UnitType>> {
    return this.service.findMany(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Birim oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateUnitTypeDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<UnitType> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Birim güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitTypeDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<UnitType> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
