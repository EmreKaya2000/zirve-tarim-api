import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Plant } from '@prisma/client';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { PlantsService } from './plants.service';
import { CreatePlantDto, UpdatePlantDto } from './dto/plant.dto';

/**
 * Bitki yönetimi (admin).
 *
 * Tüm CRUD davranışı `LookupCrudController`'dan gelir; burada yalnız
 * yönlendirme ve bağımlılık tanımlanır.
 */
@ApiTags('Katalog — Bitkiler')
@ApiBearerAuth('access-token')
@Controller('admin/plants')
export class PlantsController extends LookupCrudController<Plant, CreatePlantDto, UpdatePlantDto> {
  constructor(protected readonly service: PlantsService) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Bitki oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreatePlantDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Plant> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Bitki güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlantDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Plant> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
