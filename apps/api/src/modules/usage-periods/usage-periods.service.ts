import { Injectable } from '@nestjs/common';
import type { UsagePeriod } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateUsagePeriodDto, UpdateUsagePeriodDto } from './dto/usage-period.dto';

@Injectable()
export class UsagePeriodsService extends LookupCrudService<
  UsagePeriod,
  CreateUsagePeriodDto,
  UpdateUsagePeriodDto
> {
  protected readonly config: LookupCrudConfig = {
    model: 'usagePeriod',
    entityType: 'UsagePeriod',
    displayName: 'Kullanım Dönemi',
    searchFields: ['name'],
    sortFields: ['sortOrder', 'name', 'createdAt', 'updatedAt'],
    defaultSortField: 'sortOrder',
  };

  constructor(
    prisma: PrismaService,
    slugService: SlugService,
    queryBuilder: QueryBuilderService,
    auditLogs: AuditLogsService,
  ) {
    super(prisma, slugService, queryBuilder, auditLogs);
  }

  protected toCreateData(dto: CreateUsagePeriodDto): Record<string, unknown> {
    return {
      name: dto.name,
      description: dto.description ?? null,

      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateUsagePeriodDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),

      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
