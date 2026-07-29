import { Body, Controller, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Setting } from '@prisma/client';
import type { Request } from 'express';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { ListSettingsQueryDto, SettingUpdateItemDto, UpdateSettingDto } from './dto/setting.dto';

/**
 * Sistem ayarları (admin).
 *
 * Okuma tüm panel kullanıcılarına açıktır (mağaza telefonu gibi bilgiler
 * günlük işte gerekir); DEĞİŞTİRME yalnız SUPER_ADMIN yetkisindedir
 * (docs/ARCHITECTURE.md §8.2).
 */
@ApiTags('Sistem — Ayarlar')
@ApiBearerAuth('access-token')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Ayarları listele', description: 'Gruba göre filtrelenebilir.' })
  async findMany(@Query() query: ListSettingsQueryDto): Promise<Setting[]> {
    return this.service.findMany(query);
  }

  @Get(':key')
  @ApiParam({ name: 'key', example: 'store.phone' })
  @ApiOperation({ summary: 'Tek ayar getir' })
  async findOne(@Param('key') key: string): Promise<Setting> {
    return this.service.findByKey(key);
  }

  @Patch(':key')
  @Roles('SUPER_ADMIN')
  @ApiParam({ name: 'key', example: 'store.phone' })
  @ApiOperation({
    summary: 'Ayar değerini güncelle',
    description:
      'Anahtar DEĞİŞTİRİLEMEZ; kodda sabit olarak referans verilir. Değer, ayarın valueType alanına göre doğrulanır.',
  })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Setting> {
    return this.service.update(key, dto.value, dto.description, toActor(user, request));
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Ayarları toplu güncelle',
    description: 'Tümü tek transaction içinde yazılır; biri hata verirse hiçbiri kaydedilmez.',
  })
  async updateMany(
    @Body() items: SettingUpdateItemDto[],
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<Setting[]> {
    return this.service.updateMany(items, toActor(user, request));
  }
}
