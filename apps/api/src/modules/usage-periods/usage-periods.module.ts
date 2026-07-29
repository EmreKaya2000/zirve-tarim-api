import { Module } from '@nestjs/common';

import { UsagePeriodsController } from './usage-periods.controller';
import { UsagePeriodsService } from './usage-periods.service';

@Module({
  controllers: [UsagePeriodsController],
  providers: [UsagePeriodsService],
  exports: [UsagePeriodsService],
})
export class UsagePeriodsModule {}
