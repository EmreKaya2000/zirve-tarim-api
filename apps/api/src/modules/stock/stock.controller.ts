import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

import { StockQueryService } from './stock-query.service';
import { StockService } from './stock.service';
import { CreateStockAdjustmentDto, StockMovementQueryDto, StockQueryDto } from './dto/stock.dto';

/**
 * Stok yönetimi (admin).
 *
 * ⚠️ STOK GÜNCELLEME UCU YOKTUR — bilinçlidir.
 *
 * "Stoğu 40 yap" diyen bir PATCH ucu olsaydı, stok geçmişi eksik kalırdı:
 * kim, ne zaman, hangi gerekçeyle değiştirdiği kaybolurdu. Stok yalnız
 * HAREKET yazılarak değişir; `POST /adjustment` de bir hareket üretir.
 * Aynı nedenle `product_variants.stockQuantity` alanı varyasyon güncelleme
 * ucundan da yazılamaz (Sprint 9 şartı 2).
 */
@ApiTags('Stok')
@ApiBearerAuth('access-token')
@Controller('admin/stock')
export class StockController {
  constructor(
    private readonly query: StockQueryService,
    private readonly stock: StockService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Varyasyon bazlı stok listesi',
    description: [
      'Filtreler: ürün, kategori, marka, arama, kritik stok, stok takibi.',
      '',
      '`meta.lowStockCount` ve `meta.outOfStockCount` AYNI filtre altındaki',
      'kritik ve tükenmiş varyasyon sayısını verir.',
    ].join('\n'),
  })
  async findMany(@Query() query: StockQueryDto) {
    return this.query.findVariants(query);
  }

  @Get('low-stock')
  @ApiOperation({
    summary: 'Kritik stok listesi',
    description:
      '`stockQuantity <= lowStockThreshold` olan, stok takibi açık varyasyonlar. ' +
      'Eşiği 0 olanlar da stok tükendiğinde listeye girer.',
  })
  async findLowStock(@Query() query: StockQueryDto) {
    return this.query.findLowStock(query);
  }

  @Get('movements')
  @ApiOperation({
    summary: 'Stok hareket geçmişi',
    description:
      'Filtreler: varyasyon, ürün, hareket tipi (virgülle çoklu), yön, belge, tarih aralığı. ' +
      'Her satır hareketten önceki ve sonraki stoğu taşır.',
  })
  async findMovements(@Query() query: StockMovementQueryDto) {
    return this.query.findMovements(query);
  }

  @Post('adjustment')
  @ApiOperation({
    summary: 'Elle stok hareketi (stok düzeltme)',
    description: [
      'Açıklama ZORUNLUDUR: belgesiz bir stok değişiminin tek izi odur.',
      '',
      'Satış hareketleri (SALE, SALE_CANCEL) buradan girilemez; onları',
      'yalnız satış onayı ve iptali üretir.',
      '',
      'Fire (WASTE), hasar (DAMAGE) ve sayım düzeltmesi',
      '(INVENTORY_ADJUSTMENT) yalnız SUPER_ADMIN tarafından girilebilir.',
      '',
      'INVENTORY_ADJUSTMENT tipinde `quantity`, sayılan FİZİKSEL stoktur;',
      'yön ve fark kayıtlı stokla karşılaştırılarak hesaplanır.',
    ].join('\n'),
  })
  async adjust(
    @Body() dto: CreateStockAdjustmentDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.stock.adjust(dto, user.role, toActor(user, request));
  }
}
