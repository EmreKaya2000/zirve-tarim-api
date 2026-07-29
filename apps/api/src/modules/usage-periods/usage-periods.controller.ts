import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { UsagePeriod } from '@prisma/client';

import type { Request } from 'express';

import { LookupCrudController, toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { UsagePeriodsService } from './usage-periods.service';
import { CreateUsagePeriodDto, UpdateUsagePeriodDto } from './dto/usage-period.dto';

/**
 * Kullanım Dönemi yönetimi (admin).
 * CRUD davranışı LookupCrudController'dan gelir.
 */
@ApiTags('Katalog — Kullanım Dönemleri')
@ApiBearerAuth('access-token')
@Controller('admin/usage-periods')
export class UsagePeriodsController extends LookupCrudController<
  UsagePeriod,
  CreateUsagePeriodDto,
  UpdateUsagePeriodDto
> {
  constructor(protected readonly service: UsagePeriodsService) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Kullanım dönemi oluştur',
    description: 'Slug addan otomatik üretilir; çakışma olursa sonek eklenir.',
  })
  async create(
    @Body() dto: CreateUsagePeriodDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<UsagePeriod> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kullanım dönemi güncelle',
    description: 'Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir; mevcut bağlantılar kırılmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUsagePeriodDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<UsagePeriod> {
    return this.service.update(id, dto, toActor(user, request));
  }
}
