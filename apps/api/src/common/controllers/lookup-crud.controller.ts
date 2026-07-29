import {
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Body,
} from '@nestjs/common';
import { ApiOperation, ApiParam } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PaginatedResult } from '@zirve/types';

import {
  CurrentUser,
  type RequestUser,
} from '../../modules/auth/decorators/current-user.decorator';
import { getRequestContext } from '../utils/request-context';
import type { ActorContext } from '../types/actor-context';
import type { LookupCrudService, LookupRecord } from '../services/lookup-crud.service';
import { LookupQueryDto } from '../dto/base-query.dto';
import { SetActiveDto } from '../dto/lookup.dto';

/**
 * Controller'ların paylaştığı `ActorContext` üretimi.
 */
export function toActor(user: RequestUser, request: Request): ActorContext {
  return { id: user.id, ...getRequestContext(request) };
}

/**
 * Taksonomi modüllerinin paylaştığı GÖVDESİZ admin uçları.
 *
 * ⚠️ NEDEN `create` ve `update` BURADA YOK — bu bilinçli bir sınırdır:
 *
 * NestJS'in ValidationPipe'ı, doğrulanacak sınıfı `emitDecoratorMetadata`
 * ile üretilen `design:paramtypes` bilgisinden okur. TypeScript JENERİK tip
 * parametrelerini derleme sırasında SİLER; `@Body() dto: TCreateDto` için
 * çalışma zamanında `Object` yazılır. ValidationPipe `Object` gördüğünde
 * doğrulamayı ATLAR.
 *
 * Yani gövde alan uçlar bu sınıfta tanımlanırsa DTO doğrulaması sessizce
 * devre dışı kalır — hiçbir hata vermeden. Bu, en tehlikeli hata sınıfıdır.
 *
 * Bu yüzden gövde alan uçlar (`POST`, `PATCH :id`) her alt controller'da
 * SOMUT DTO tipleriyle tanımlanır. `SetActiveDto` somut bir sınıf olduğu
 * için `PATCH :id/status` burada kalabilir.
 */
export abstract class LookupCrudController<
  TRecord extends LookupRecord,
  TCreateDto extends { name: string },
  TUpdateDto extends { name?: string },
> {
  protected abstract readonly service: LookupCrudService<TRecord, TCreateDto, TUpdateDto>;

  @Get()
  @ApiOperation({
    summary: 'Listele',
    description: 'Sayfalama, arama, aktiflik filtresi ve sıralama destekler.',
  })
  async findMany(@Query() query: LookupQueryDto): Promise<PaginatedResult<TRecord>> {
    return this.service.findMany(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Tek kayıt getir' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TRecord> {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Aktifleştir / pasife al' })
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<TRecord> {
    return this.service.setActive(id, dto.isActive, toActor(user, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kaydı sil (soft delete)',
    description:
      'Fiziksel silme YAPILMAZ: bu kayıtlara ürünler referans verir ve geçmiş kayıtlar kırılmamalıdır.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, toActor(user, request));
  }
}
