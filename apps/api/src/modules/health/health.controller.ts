import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ERROR_CODES } from '@zirve/types';

import {
  ApiErrorResponse,
  ApiStandardResponse,
} from '../../common/swagger/api-response.decorators';
import { Public } from '../auth/decorators/public.decorator';
import { HealthCheckResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

/**
 * Sağlık kontrolü.
 *
 * Bu uç bilinçli olarak global `API_PREFIX` DIŞINDADIR (`/health`), çünkü
 * konteyner orkestratörleri ve yük dengeleyiciler sabit bir yol bekler;
 * API sürümlemesi (`/api/v1`) değiştiğinde bu yolun kırılmaması gerekir.
 */
@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Uygulama ve bağımlılık sağlık kontrolü',
    description:
      'Veritabanı bağlantısı dahil sistem durumunu döndürür. Veritabanına erişilemiyorsa 503 döner.',
  })
  @ApiStandardResponse(HealthCheckResponseDto, {
    description: 'Sistem sağlıklı.',
  })
  @ApiErrorResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    ERROR_CODES.SERVICE_UNAVAILABLE,
    'Bir bağımlılık erişilemez durumda (ör. veritabanı).',
  )
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthCheckResponseDto> {
    const result = await this.healthService.check();

    // Gövde her iki durumda da aynı şekli taşır; yalnız HTTP durumu değişir.
    // Böylece izleme araçları hem durum kodunu hem ayrıntıyı okuyabilir.
    if (result.status === 'error') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }
}
