import { Injectable } from '@nestjs/common';
import type { SideEffect } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CreateSideEffectDto,
  ListSideEffectsQueryDto,
  UpdateSideEffectDto,
} from './dto/side-effect.dto';

@Injectable()
export class SideEffectsService extends LookupCrudService<
  SideEffect,
  CreateSideEffectDto,
  UpdateSideEffectDto
> {
  protected readonly config: LookupCrudConfig = {
    model: 'sideEffect',
    entityType: 'SideEffect',
    displayName: 'Yan Etki',
    searchFields: ['name', 'precaution'],
    sortFields: ['sortOrder', 'name', 'severity', 'createdAt', 'updatedAt'],
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

  /** Ciddiyet filtresi. */
  protected override buildExtraFilters(query: ListSideEffectsQueryDto): Record<string, unknown> {
    return query.severity !== undefined ? { severity: query.severity } : {};
  }

  protected toCreateData(dto: CreateSideEffectDto): Record<string, unknown> {
    return {
      name: dto.name,
      description: dto.description ?? null,
      severity: dto.severity ?? 'LOW',
      precaution: dto.precaution ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateSideEffectDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.severity !== undefined && { severity: dto.severity }),
      ...(dto.precaution !== undefined && { precaution: dto.precaution }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
