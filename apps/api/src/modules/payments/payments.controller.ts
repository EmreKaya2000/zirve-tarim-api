import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { toActor } from '../../common/controllers/lookup-crud.controller';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

import { PaymentsService } from './payments.service';
import { DeletePaymentDto, PaymentQueryDto } from './dto/payment.dto';

/**
 * Tahsilat listesi (admin).
 *
 * Ödeme EKLEME ucu burada değil, satışın altındadır
 * (`POST /admin/sales/:id/payments`): ödeme daima bir satışa aittir.
 */
@ApiTags('Ödemeler')
@ApiBearerAuth('access-token')
@Controller('admin/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Ödemeleri listele',
    description:
      'Filtreler: yöntem, müşteri, satış, tarih aralığı, arama. ' +
      '`meta.totalAmount` filtrelenmiş tahsilat toplamını verir.',
  })
  async findMany(@Query() query: PaymentQueryDto) {
    return this.service.findMany(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Ödeme detayı' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ödemeyi sil (soft delete)',
    description: [
      'Kural 4: finansal kayıt hard delete edilmez. Gerekçe ZORUNLUDUR.',
      '',
      'Silme sonrası borç yeniden doğar ve satış durumu düzeltilir',
      '(PAID -> PARTIALLY_PAID gibi) — aynı transaction içinde.',
    ].join('\n'),
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeletePaymentDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, dto.reason, toActor(user, request));
  }
}
