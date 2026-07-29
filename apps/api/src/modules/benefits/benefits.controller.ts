import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Benefit } from '@prisma/client';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { BenefitsService } from './benefits.service';
import { CreateBenefitDto, UpdateBenefitDto } from './dto/benefit.dto';

/**
 * Yarar yönetimi (admin).
 * CRUD davranışı LookupCrudController'dan gelir.
 */
@ApiTags('Katalog — Yararlar')
@ApiBearerAuth('access-token')
@Controller('admin/benefits')
export class BenefitsController extends LookupCrudController<
  Benefit,
  CreateBenefitDto,
  UpdateBenefitDto
> {
  constructor(protected readonly service: BenefitsService) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Yarar oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateBenefitDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Benefit> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Yarar güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBenefitDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Benefit> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
