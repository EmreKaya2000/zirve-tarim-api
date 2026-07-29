import { Module } from '@nestjs/common';

import { ProductRelationsController } from './product-relations.controller';
import { ProductRelationsService } from './product-relations.service';

@Module({
  controllers: [ProductRelationsController],
  providers: [ProductRelationsService],
  exports: [ProductRelationsService],
})
export class ProductRelationsModule {}
