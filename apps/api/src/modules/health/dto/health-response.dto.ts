import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  HEALTH_STATUSES,
  OVERALL_HEALTH_STATUSES,
  type HealthStatus,
  type OverallHealthStatus,
} from '@zirve/types';

/** Tek bir bağımlılığın (ör. veritabanı) sağlık bilgisi — Swagger gösterimi. */
export class DependencyHealthDto {
  @ApiProperty({ enum: HEALTH_STATUSES, example: 'up' })
  status!: HealthStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Yanıt süresi (ms). Erişilemiyorsa null.',
  })
  latencyMs!: number | null;

  @ApiPropertyOptional({
    example: "Can't reach database server at localhost:5432",
    description: 'Yalnızca hata durumunda ve yalnızca üretim dışında doldurulur.',
  })
  message?: string;
}

/** GET /health yanıtının `data` gövdesi. */
export class HealthDependenciesDto {
  @ApiProperty({ type: DependencyHealthDto })
  database!: DependencyHealthDto;
}

export class HealthCheckResponseDto {
  @ApiProperty({ enum: OVERALL_HEALTH_STATUSES, example: 'ok' })
  status!: OverallHealthStatus;

  @ApiProperty({ example: '2026-07-27T12:00:00.000Z', description: 'ISO 8601, UTC.' })
  timestamp!: string;

  @ApiProperty({ example: 1284, description: 'Sürecin ayakta kalma süresi (saniye).' })
  uptimeSeconds!: number;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ example: 'development' })
  environment!: string;

  @ApiProperty({ type: HealthDependenciesDto })
  dependencies!: HealthDependenciesDto;
}
