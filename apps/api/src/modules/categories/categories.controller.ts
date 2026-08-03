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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Category } from '@prisma/client';
import type { Request } from 'express';
import type { PaginatedResult } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { SetActiveDto } from '../../common/dto/lookup.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import {
  CategoryIconService,
  MAX_ICON_SIZE_BYTES,
  MAX_ICON_ASPECT_RATIO,
  MAX_ICON_DIMENSION,
  MIN_ICON_DIMENSION,
} from '../uploads/category-icon.service';
import type { UploadedFileLike } from '../uploads/image-validation';
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
  constructor(
    private readonly service: CategoriesService,
    private readonly icons: CategoryIconService,
  ) {}

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

  @Post(':id/icon')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ICON_SIZE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Kategori ikonu yükle',
    description: [
      `JPG, PNG ve WebP kabul edilir; en fazla ${MAX_ICON_SIZE_BYTES / 1024 / 1024} MB.`,
      '',
      'SVG KABUL EDİLMEZ: XML olduğu için script taşıyabilir ve kendi alan',
      'adımızdan servis edildiğinde saklanmış XSS riskine dönüşür.',
      '',
      `Boyut: en az ${MIN_ICON_DIMENSION}×${MIN_ICON_DIMENSION}, en fazla ` +
        `${MAX_ICON_DIMENSION}×${MAX_ICON_DIMENSION} piksel. Kareye yakın olmalıdır ` +
        `(en/boy oranı en çok ${MAX_ICON_ASPECT_RATIO}).`,
      '',
      'Görsel 128×128 WebP olarak yeniden üretilir; oran korunur, boşluk',
      'şeffaf doldurulur ve EXIF/metadata ATILIR (konum sızıntısı önlemi).',
      '',
      'Kategoride ikon varsa yenisiyle DEĞİŞTİRİLİR, eski dosya silinir.',
    ].join('\n'),
  })
  async uploadIcon(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<{ iconUrl: string }> {
    return this.icons.upload(id, file, toActor(user, request));
  }

  @Delete(':id/icon')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kategori ikonunu kaldır',
    description: 'İkon silinir; vitrin varsayılan ikona döner.',
  })
  async removeIcon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.icons.remove(id, toActor(user, request));
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
