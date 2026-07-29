import { Module } from '@nestjs/common';

import { SoilTypesController } from './soil-types.controller';
import { SoilTypesService } from './soil-types.service';

@Module({
  controllers: [SoilTypesController],
  providers: [SoilTypesService],
  exports: [SoilTypesService],
})
export class SoilTypesModule {}
