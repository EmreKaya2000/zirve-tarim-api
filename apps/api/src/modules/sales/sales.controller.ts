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

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from '../payments/payments.service';
import { CreatePaymentDto } from '../payments/dto/payment.dto';

import { SalesService } from './sales.service';
import {
  AddAdditionalCostDto,
  CancelSaleDto,
  CreateSaleDto,
  SaleQueryDto,
  UpdateSaleDto,
} from './dto/sale.dto';

/**
 * Satış yönetimi (admin).
 *
 * SİLME UCU YOKTUR (Kural 4): satış finansal bir belgedir. Hatalı satış
 * `POST /:id/cancel` ile gerekçesiyle iptal edilir; kayıt ve gerekçesi
 * kalıcı olarak durur.
 */
@ApiTags('Satışlar')
@ApiBearerAuth('access-token')
@Controller('admin/sales')
export class SalesController {
  constructor(
    private readonly service: SalesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Satışları listele',
    description:
      'Filtreler: durum (virgülle çoklu), müşteri, tarih aralığı, ödeme tipi, vadesi geçmiş.',
  })
  async findMany(@Query() query: SaleQueryDto) {
    return this.service.findMany(query);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Duruma göre satış sayıları' })
  async counts(): Promise<Record<string, number>> {
    return this.service.countByStatus();
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Satış detayı',
    description: 'Kalemler (snapshot ve kâr alanlarıyla), ödemeler ve ek maliyetler.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Taslak satış oluştur',
    description: [
      'Satış DRAFT durumunda doğar; onaylanmadan borç doğurmaz ve müşteri',
      'finans özetine girmez.',
      '',
      'Kalem fiyatları SATIŞ ANINDA kopyalanır (Kural 5). Alış fiyatı',
      'istemciden ASLA alınmaz — varyasyondan okunur.',
      '',
      '`initialPayment` verilirse satış otomatik onaylanır ve ödeme eklenir:',
      'taslak satışa ödeme eklenemez.',
    ].join('\n'),
  })
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Satışı güncelle',
    description: 'YALNIZ TASLAK satış düzenlenebilir. Onaylanmış satış değiştirilemez.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSaleDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.update(id, dto, toActor(user, request));
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Satışı onayla',
    description: [
      'DRAFT -> CONFIRMED. Onaylanan satış borç doğurur ve müşteri finans',
      'özetine girer.',
      '',
      'SPRINT 9 NOTU: stok kontrolü ve düşümü bu akışa eklenecek; şu anda',
      'finalize stoğa DOKUNMAZ.',
    ].join('\n'),
  })
  async finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.finalize(id, toActor(user, request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Satışı iptal et',
    description:
      'İptal nedeni ZORUNLUDUR. Tamamı ödenmiş satış iptal edilemez: ' +
      'önce ödeme silinmelidir (iade akışı bu sprintte yok).',
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSaleDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.cancel(id, dto, toActor(user, request));
  }

  // --- Ödemeler ---

  @Get(':id/payments')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Satışın ödemeleri' })
  async listPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findBySale(id);
  }

  @Post(':id/payments')
  @ApiOperation({
    summary: 'Satışa ödeme ekle',
    description: [
      'Kurallar: tutar > 0, kalan borç AŞILAMAZ, DRAFT/CANCELLED satışa',
      'ödeme eklenemez, çek/senette vade zorunludur.',
      '',
      'Ödeme sonrası satış durumu otomatik güncellenir:',
      'kısmi -> PARTIALLY_PAID, tamamı -> PAID.',
    ].join('\n'),
  })
  async addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.payments.create(id, dto, toActor(user, request));
  }

  // --- Ek maliyetler ---

  @Post(':id/additional-costs')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ek maliyet ekle',
    description:
      'Finalize SONRASINDA da eklenebilir (nakliye faturası sonradan gelebilir); ' +
      'netProfit aynı transaction içinde yeniden hesaplanır.',
  })
  async addAdditionalCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAdditionalCostDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.addAdditionalCost(id, dto, toActor(user, request));
  }

  @Delete(':id/additional-costs/:costId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'costId', format: 'uuid' })
  @ApiOperation({ summary: 'Ek maliyeti kaldır' })
  async removeAdditionalCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.removeAdditionalCost(id, costId, toActor(user, request));
  }
}
