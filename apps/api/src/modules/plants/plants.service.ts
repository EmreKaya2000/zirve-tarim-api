import { Injectable } from '@nestjs/common';
import type { Plant } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreatePlantDto, UpdatePlantDto } from './dto/plant.dto';

@Injectable()
export class PlantsService extends LookupCrudService<Plant, CreatePlantDto, UpdatePlantDto> {
  protected readonly config: LookupCrudConfig = {
    model: 'plant',
    entityType: 'Plant',
    displayName: 'Bitki',
    searchFields: ['name', 'latinName'],
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

  protected toCreateData(dto: CreatePlantDto): Record<string, unknown> {
    return {
      name: dto.name,
      latinName: dto.latinName ?? null,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdatePlantDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.latinName !== undefined && { latinName: dto.latinName }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
