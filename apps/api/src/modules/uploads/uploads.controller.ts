import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { ProductImage } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { ERROR_CODES } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { ApiErrorResponse } from '../../common/swagger/api-response.decorators';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  UploadsService,
  type UploadedFileLike,
} from './uploads.service';

/** Görsel sıralama gövdesi. */
export class ReorderImagesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Sıralama listesi boş olamaz.' })
  @IsUUID('4', { each: true, message: 'Her öğe geçerli bir UUID olmalıdır.' })
  imageIds!: string[];
}

@ApiTags('Ürünler — Görseller')
@ApiBearerAuth('access-token')
@Controller('admin/products/:productId/images')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES_PER_PRODUCT, {
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: MAX_IMAGES_PER_PRODUCT },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary: 'Ürün görseli yükle (çoklu)',
    description: [
      'JPG, PNG ve WebP kabul edilir; dosya başına en fazla 5 MB.',
      '',
      'Doğrulama ÜÇ katmanlıdır: boyut, bildirilen MIME tipi ve dosyanın',
      'GERÇEK içerik imzası (magic bytes). Üçüncüsü olmadan uzantısı',
      'değiştirilmiş bir dosya yüklenebilirdi.',
      '',
      'İlk yüklenen görsel otomatik olarak ana görsel olur.',
    ].join('\n'),
  })
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.UNPROCESSABLE,
    'Dosya tipi, boyutu veya adedi kurallara uymuyor.',
  )
  async upload(
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFiles() files: UploadedFileLike[],
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductImage[]> {
    return this.service.uploadProductImages(productId, files ?? [], toActor(user, request));
  }

  @Patch('reorder')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'Görselleri yeniden sırala',
    description: 'Gönderilen dizi TÜM görselleri içermelidir; sıra dizideki sıradır.',
  })
  async reorder(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderImagesDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductImage[]> {
    return this.service.reorderImages(productId, dto.imageIds, toActor(user, request));
  }

  @Patch(':imageId/primary')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiOperation({ summary: 'Ana görseli seç' })
  async setPrimary(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductImage> {
    return this.service.setPrimaryImage(productId, imageId, toActor(user, request));
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiOperation({
    summary: 'Görsel sil',
    description: 'Ana görsel silinirse sıradaki görsel otomatik olarak ana görsel olur.',
  })
  async remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.deleteProductImage(productId, imageId, toActor(user, request));
  }
}
