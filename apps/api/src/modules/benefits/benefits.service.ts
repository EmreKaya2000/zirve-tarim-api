import { Injectable } from '@nestjs/common';
import type { Benefit } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateBenefitDto, UpdateBenefitDto } from './dto/benefit.dto';

@Injectable()
export class BenefitsService extends LookupCrudService<
  Benefit,
  CreateBenefitDto,
  UpdateBenefitDto
> {
  protected readonly config: LookupCrudConfig = {
    model: 'benefit',
    entityType: 'Benefit',
    displayName: 'Yarar',
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

  protected toCreateData(dto: CreateBenefitDto): Record<string, unknown> {
    return {
      name: dto.name,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateBenefitDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
