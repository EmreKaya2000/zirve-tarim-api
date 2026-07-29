import { Injectable } from '@nestjs/common';
import type { SoilType } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateSoilTypeDto, UpdateSoilTypeDto } from './dto/soil-type.dto';

@Injectable()
export class SoilTypesService extends LookupCrudService<
  SoilType,
  CreateSoilTypeDto,
  UpdateSoilTypeDto
> {
  protected readonly config: LookupCrudConfig = {
    model: 'soilType',
    entityType: 'SoilType',
    displayName: 'Toprak Türü',
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

  protected toCreateData(dto: CreateSoilTypeDto): Record<string, unknown> {
    return {
      name: dto.name,
      description: dto.description ?? null,
      phRange: dto.phRange ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateSoilTypeDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.phRange !== undefined && { phRange: dto.phRange }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
