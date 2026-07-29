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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { ProductVariant } from '@prisma/client';
import type { Request } from 'express';
import { ERROR_CODES } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { ApiErrorResponse } from '../../common/swagger/api-response.decorators';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ProductVariantsService } from './product-variants.service';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

/**
 * Ürün varyasyonları (admin).
 *
 * Varyasyon satılabilir asıl birimdir: fiyat, stok ve SKU buradadır.
 */
@ApiTags('Ürünler — Varyasyonlar')
@ApiBearerAuth('access-token')
@Controller('admin/products/:productId/variants')
export class ProductVariantsController {
  constructor(private readonly service: ProductVariantsService) {}

  @Get()
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Ürünün varyasyonlarını listele' })
  async findMany(@Param('productId', ParseUUIDPipe) productId: string): Promise<ProductVariant[]> {
    return this.service.findMany(productId);
  }

  @Post()
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'Varyasyon ekle',
    description: [
      'Parasal ve miktar alanları STRING taşınır (kuruş kaybını önlemek için).',
      '',
      'Birimin `allowsDecimal` değeri false ise ondalıklı miktar REDDEDİLİR:',
      '"2,5 kg" geçerlidir ama "2,5 adet" değildir.',
      '',
      'Ürünün ilk varyasyonu otomatik olarak varsayılan olur.',
    ].join('\n'),
  })
  @ApiErrorResponse(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, 'Bu SKU zaten kullanılıyor.')
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.UNPROCESSABLE,
    'Miktar veya fiyat kuralları ihlal edildi.',
  )
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductVariant> {
    return this.service.create(productId, dto, toActor(user, request));
  }

  @Patch(':variantId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({
    summary: 'Varyasyon güncelle',
    description:
      'Kurallar mevcut ve yeni değerlerin BİRLEŞİMİ üzerinde doğrulanır; tek alan gönderildiğinde de bütünlük korunur.',
  })
  async update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductVariant> {
    return this.service.update(productId, variantId, dto, toActor(user, request));
  }

  @Delete(':variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiOperation({
    summary: 'Varyasyon sil (soft delete)',
    description: 'Son aktif varyasyon silinirse ürün otomatik olarak yayından kaldırılır.',
  })
  async remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(productId, variantId, toActor(user, request));
  }
}
