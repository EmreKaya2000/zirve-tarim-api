import { Injectable } from '@nestjs/common';
import { Prisma, type UnitType } from '@prisma/client';
import { ERROR_CODES } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import {
  LookupCrudService,
  type LookupCrudConfig,
} from '../../common/services/lookup-crud.service';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CreateUnitTypeDto,
  ListUnitTypesQueryDto,
  UpdateUnitTypeDto,
} from './dto/unit-type.dto';
import type { ActorContext } from '../../common/types/actor-context';

@Injectable()
export class UnitTypesService extends LookupCrudService<
  UnitType,
  CreateUnitTypeDto,
  UpdateUnitTypeDto
> {
  protected readonly config: LookupCrudConfig = {
    model: 'unitType',
    entityType: 'UnitType',
    displayName: 'Birim',
    searchFields: ['name', 'code'],
    sortFields: ['sortOrder', 'name', 'code', 'measurementType', 'createdAt', 'updatedAt'],
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

  protected override buildExtraFilters(query: ListUnitTypesQueryDto): Record<string, unknown> {
    return query.measurementType !== undefined ? { measurementType: query.measurementType } : {};
  }

  /** Kod benzersizliği slug'dan bağımsızdır; ayrıca kontrol edilir. */
  override async create(dto: CreateUnitTypeDto, actor: ActorContext): Promise<UnitType> {
    await this.assertCodeAvailable(dto.code);

    return super.create(dto, actor);
  }

  override async update(
    id: string,
    dto: UpdateUnitTypeDto,
    actor: ActorContext,
  ): Promise<UnitType> {
    if (dto.code !== undefined) {
      await this.assertCodeAvailable(dto.code, id);
    }

    return super.update(id, dto, actor);
  }

  protected toCreateData(dto: CreateUnitTypeDto): Record<string, unknown> {
    return {
      name: dto.name,
      code: dto.code,
      description: dto.description ?? null,
      measurementType: dto.measurementType,
      allowsDecimal: dto.allowsDecimal,
      conversionFactor: toDecimal(dto.conversionFactor),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  protected toUpdateData(dto: UpdateUnitTypeDto): Record<string, unknown> {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.measurementType !== undefined && { measurementType: dto.measurementType }),
      ...(dto.allowsDecimal !== undefined && { allowsDecimal: dto.allowsDecimal }),
      ...(dto.conversionFactor !== undefined && {
        conversionFactor: toDecimal(dto.conversionFactor),
      }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }

  private async assertCodeAvailable(code: string, excludeId?: string): Promise<void> {
    const found = await this.prisma.unitType.findFirst({
      where: {
        code,
        deletedAt: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    if (found !== null) {
      throw new AppException(
        ERROR_CODES.CONFLICT,
        `Bu birim kodu zaten kullanılıyor: ${code}`,
        409,
        [{ field: 'code', message: 'Bu birim kodu zaten kullanılıyor.' }],
      );
    }
  }
}

/**
 * String olarak gelen çevrim katsayısını Prisma Decimal'e çevirir.
 * Kural 2: sayı float'a UĞRATILMADAN doğrudan Decimal'e verilir.
 */
function toDecimal(value: string | undefined): Prisma.Decimal | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }

  return new Prisma.Decimal(value);
}
