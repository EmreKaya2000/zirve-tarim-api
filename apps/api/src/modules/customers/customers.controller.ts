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

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

import { CustomersService, type CustomerFinanceSummary } from './customers.service';
import {
  CheckDuplicatePhoneDto,
  CreateCustomerDto,
  CreateCustomerNoteDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * Müşteri yönetimi (admin).
 *
 * KALAN BORÇ ALAN OLARAK TUTULMAZ (Sprint 7 şartı 3): her istekte satış ve
 * ödeme kayıtlarından hesaplanır. Saklansaydı ikinci bir tutarsızlık
 * kaynağı olurdu — satış iptal edilip bakiye güncellenmediğinde fark
 * edilmesi aylar alırdı.
 */
@ApiTags('Müşteriler')
@ApiBearerAuth('access-token')
@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @ApiOperation({
    summary: 'Müşterileri listele',
    description:
      'Arama (ad, kod, telefon, e-posta, vergi no), tür ve borç filtresi. ' +
      'Her satır türetilmiş borç bilgisiyle döner.',
  })
  async findMany(@Query() query: CustomerQueryDto) {
    return this.service.findMany(query);
  }

  /**
   * `:id` ROTASINDAN ÖNCE tanımlanmalıdır.
   *
   * NestJS rotaları tanım sırasına göre eşler; aşağıda kalsaydı
   * `/check-duplicate` önce `@Get(':id')` ile eşleşir ve `ParseUUIDPipe`
   * "geçersiz kimlik" hatası verirdi.
   */
  @Get('check-duplicate')
  @ApiOperation({
    summary: 'Mükerrer telefon kontrolü',
    description:
      'Form KAYDETMEDEN ÖNCE uyarabilsin diye vardır. Kayıt akışını engellemez; ' +
      'yalnız aynı numaralı mevcut müşteriyi bildirir.',
  })
  async checkDuplicate(@Query() query: CheckDuplicatePhoneDto) {
    return this.service.checkDuplicatePhone(query.phone, query.excludeId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Müşteri detayı', description: 'Finans özetiyle birlikte döner.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/financial-summary')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Müşteri finans özeti (SPEC §9.5)',
    description:
      'Toplam satış, toplam tahsilat, kalan borç, vadesi geçmiş borç, ' +
      'kredi limiti ve kullanılabilir limit.',
  })
  async financeSummary(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerFinanceSummary> {
    return this.service.financeSummary(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Müşteri oluştur',
    description: [
      'Telefon numarası normalleştirilerek saklanır.',
      '',
      'MÜKERRER TELEFON KAYDI ENGELLEMEZ, UYARIR: aynı hattı paylaşan iki',
      'müşteri (baba–oğul, şirket–sahibi) gerçek bir durumdur. Çakışma',
      'varsa yanıt gövdesinde `warnings` alanı döner.',
    ].join('\n'),
  })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.create(dto, toActor(user, request));
  }

  @Get(':id/sales')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Müşterinin satışları',
    description: 'Taslak ve iptal dahil TÜM satışlar; en yeni önce.',
  })
  async findSales(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.service.findSales(id, query);
  }

  @Get(':id/payments')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Müşterinin tahsilatları',
    description: 'Silinmiş ödemeler listelenmez.',
  })
  async findPayments(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.service.findPayments(id, query);
  }

  @Get(':id/notes')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Görüşme notları', description: 'En yeni not önce.' })
  async findNotes(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.service.findNotes(id, query);
  }

  @Post(':id/notes')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Görüşme notu ekle',
    description:
      'Müşterinin `note` alanının ÜZERİNE YAZMAZ: o kalıcı bilgi, bu tarihli kayıt zinciridir.',
  })
  async addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerNoteDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.addNote(id, dto.body, toActor(user, request));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Müşteri güncelle',
    description: 'Devir bakiyesi (openingBalance) BİLİNÇLİ OLARAK güncellenemez.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    return this.service.update(id, dto, toActor(user, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Müşteriyi sil (soft delete)',
    description: 'Borcu olan müşteri silinemez: alacak takibi kaybolur.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, toActor(user, request));
  }
}
