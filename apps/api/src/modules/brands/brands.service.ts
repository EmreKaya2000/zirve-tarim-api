import { Injectable } from '@nestjs/common';
import type { Brand } from '@prisma/client';

import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Injectable()
export class BrandsService extends LookupCrudService<Brand, CreateBrandDto, UpdateBrandDto> {
  protected readonly config: LookupCrudConfig = {
    model: 'brand',
    entityType: 'Brand',
    displayName: 'Marka',
    searchFields: ['name', 'country'],
    sortFields: ['sortOrder', 'name', 'country', 'createdAt', 'updatedAt'],
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

  protected toCreateData(dto: CreateBrandDto): Record<string, unknown> {
    return {
      name: dto.name,
      description: dto.description ?? null,
      logoUrl: dto.logoUrl ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      country: dto.country ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateBrandDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      ...(dto.websiteUrl !== undefined && { websiteUrl: dto.websiteUrl }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }
}
