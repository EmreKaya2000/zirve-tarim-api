import { Global, Module } from '@nestjs/common';

import { NumberSequenceService } from './services/number-sequence.service';
import { QueryBuilderService } from './services/query-builder.service';
import { SlugService } from './services/slug.service';

/**
 * Ortak altyapı servisleri.
 *
 * Global'dir: liste kurma ve slug üretimi neredeyse her modülün ihtiyacıdır;
 * her birinde tekrar import etmek gereksiz gürültü olur.
 */
@Global()
@Module({
  providers: [NumberSequenceService, QueryBuilderService, SlugService],
  exports: [NumberSequenceService, QueryBuilderService, SlugService],
})
export class CommonModule {}
