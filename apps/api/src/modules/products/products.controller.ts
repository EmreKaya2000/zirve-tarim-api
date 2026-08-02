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
import type { Request } from 'express';
import { ERROR_CODES, type PaginatedResult } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { ApiErrorResponse } from '../../common/swagger/api-response.decorators';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto, ListProductsQueryDto, UpdateProductDto } from './dto/product.dto';

/** Ürün yönetimi (admin). */
@ApiTags('Ürünler')
@ApiBearerAuth('access-token')
@Controller('admin/products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'Ürünleri listele',
    description:
      'Sayfalama, arama, kategori/marka/aktiflik/yayın filtreleri ve kritik stok filtresi destekler.',
  })
  async findMany(@Query() query: ListProductsQueryDto): Promise<PaginatedResult<unknown>> {
    return this.service.findManyAdmin(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ürün detayı',
    description: 'Form için tüm ilişkileri içerir. Maliyet alanları BU yanıtta bulunur.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Ürün oluştur',
    description: [
      'Slug addan üretilir. En az bir kategori zorunludur; yalnız biri ana kategori olabilir.',
      '',
      'Yeni ürün YAYINLANMAMIŞ olarak oluşturulur: yayın için en az bir aktif varyasyon gerekir.',
    ].join('\n'),
  })
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.UNPROCESSABLE,
    'Birden fazla ana kategori veya yinelenen kategori.',
  )
  async create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ürün güncelle',
    description:
      'Gönderilen ilişki listeleri SON DURUMDUR (tamamen değiştirilir). Gönderilmeyen ilişkilere dokunulmaz.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.service.update(id, dto, toActor(user, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ürün sil (soft delete)',
    description: 'Ürün ve varyasyonları pasife alınır; geçmiş satış satırları kırılmaz.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, toActor(user, request));
  }
}
