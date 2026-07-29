import { Module } from '@nestjs/common';

import { SideEffectsController } from './side-effects.controller';
import { SideEffectsService } from './side-effects.service';

@Module({
  controllers: [SideEffectsController],
  providers: [SideEffectsService],
  exports: [SideEffectsService],
})
export class SideEffectsModule {}
