import { Module } from '@nestjs/common';

import { CategoryIconService } from '../uploads/category-icon.service';
import { UploadsModule } from '../uploads/uploads.module';

import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * `UploadsModule` ikon yüklemesi için import edilir: depolama sürücüsü
 * (STORAGE_DRIVER) oradan gelir, böylece S3'e geçişte burada değişiklik
 * gerekmez.
 */
@Module({
  imports: [UploadsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryIconService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
