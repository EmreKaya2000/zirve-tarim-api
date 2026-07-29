import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductRelationType, type ProductRelation } from '@prisma/client';
import type { Request } from 'express';
import { ERROR_CODES, PRODUCT_RELATION_TYPES } from '@zirve/types';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { ApiErrorResponse } from '../../common/swagger/api-response.decorators';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ProductRelationsService, type RelationView } from './product-relations.service';
import { CreateRelationDto } from './dto/relation.dto';

@ApiTags('Ürünler — İlişkiler')
@ApiBearerAuth('access-token')
@Controller('admin/products/:productId/relations')
export class ProductRelationsController {
  constructor(private readonly service: ProductRelationsService) {}

  @Get()
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiQuery({ name: 'type', required: false, enum: PRODUCT_RELATION_TYPES })
  @ApiOperation({
    summary: 'Ürünün ilişkilerini listele',
    description: [
      'SİMETRİK ilişkiler (COMPATIBLE, INCOMPATIBLE, SIMILAR) iki yönden de görünür.',
      'YÖNLÜ ilişkiler yalnız KAYNAK ürünün listesinde görünür.',
    ].join('\n'),
  })
  async findMany(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('type') type?: ProductRelationType,
  ): Promise<RelationView[]> {
    return this.service.findMany(productId, type);
  }

  @Post()
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'İlişki ekle',
    description: [
      'Simetrik türlerde kaynak/hedef sırası otomatik kanonikleştirilir;',
      'aynı çift ters yönde ikinci kez eklenemez.',
      '',
      'INCOMPATIBLE türünde `note` (gerekçe) ZORUNLUDUR.',
    ].join('\n'),
  })
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.UNPROCESSABLE,
    'Ürün kendisiyle ilişkilendirilemez / INCOMPATIBLE için gerekçe eksik.',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, 'Bu ilişki zaten tanımlı.')
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateRelationDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<ProductRelation> {
    return this.service.create(productId, dto, toActor(user, request));
  }

  @Delete(':relationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'relationId', format: 'uuid' })
  @ApiOperation({
    summary: 'İlişkiyi kaldır',
    description: 'Yönlü ilişki yalnızca KAYNAK ürün üzerinden kaldırılabilir.',
  })
  async remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(productId, relationId, toActor(user, request));
  }
}
