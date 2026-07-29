import { Module } from '@nestjs/common';

import { LocalDiskStorage } from './storage/local-disk.storage';
import { STORAGE_DRIVER } from './storage/storage.interface';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Dosya yükleme.
 *
 * Depolama sürücüsü TEK BİR SATIRDA değiştirilir: S3'e geçmek için
 * `useClass` değeri `S3Storage` yapılır, başka hiçbir yerde değişiklik
 * gerekmez (docs/ARCHITECTURE.md R-09).
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, { provide: STORAGE_DRIVER, useClass: LocalDiskStorage }],
  exports: [UploadsService, STORAGE_DRIVER],
})
export class UploadsModule {}
