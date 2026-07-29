import { AuditAction, Prisma } from '@prisma/client';
import { ERROR_CODES, type PaginatedResult } from '@zirve/types';

import { AppException } from '../exceptions/app.exception';
import type { ActorContext } from '../types/actor-context';
import type { PaginationQueryDto } from '../dto/pagination-query.dto';
import type { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { SluggableModel, SlugService } from './slug.service';
import type { QueryBuilderService } from './query-builder.service';

/** Taksonomi kayıtlarının ortak alanları. */
export interface LookupRecord {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  deletedAt: Date | null;
}

/** Alt sınıfın sağlaması gereken yapılandırma. */
export interface LookupCrudConfig {
  /** Prisma delegate adı. Örn. 'plant' */
  model: SluggableModel;
  /** Denetim kaydında görünecek varlık adı. Örn. 'Plant' */
  entityType: string;
  /** Kullanıcıya gösterilecek Türkçe ad. Örn. 'Bitki' */
  displayName: string;
  /** Aramanın yapılacağı alanlar. */
  searchFields: readonly string[];
  /** Sıralamaya izin verilen alanlar (whitelist). */
  sortFields: readonly string[];
  /** Varsayılan sıralama alanı. */
  defaultSortField: string;
}

/** Prisma delegate'lerinin ortak yüzeyi. */
interface GenericDelegate {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
}

/**
 * Basit taksonomi tablolarının ortak CRUD mantığı.
 *
 * Bitki, toprak türü, yarar, yan etki, kullanım dönemi ve birim modülleri
 * yapı olarak aynıdır: ad + slug + açıklama + sıra + aktiflik. Bu sınıf o
 * ortak davranışı tek yerde toplar; alt sınıflar yalnız kendi alan
 * farklılıklarını tanımlar.
 *
 * Tek yerde toplanan davranışlar:
 *  - Slug üretimi ve benzersizliği
 *  - Soft delete (hard delete YOK — ürün referansları kırılmasın)
 *  - Denetim kaydı (her yazma işlemi)
 *  - Sayfalama/arama/sıralama sözleşmesi
 */
export abstract class LookupCrudService<TRecord extends LookupRecord, TCreateDto, TUpdateDto> {
  protected abstract readonly config: LookupCrudConfig;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly slugService: SlugService,
    protected readonly queryBuilder: QueryBuilderService,
    protected readonly auditLogs: AuditLogsService,
  ) {}

  /** Prisma delegate'ini döndürür. */
  protected get delegate(): GenericDelegate {
    return this.prisma[this.config.model] as unknown as GenericDelegate;
  }

  /** Alt sınıf, DTO'yu Prisma `data` nesnesine çevirir (slug hariç). */
  protected abstract toCreateData(dto: TCreateDto): Record<string, unknown>;

  /** Alt sınıf, güncelleme DTO'sunu `data` nesnesine çevirir (slug hariç). */
  protected abstract toUpdateData(dto: TUpdateDto): Record<string, unknown>;

  /** Modüle özgü ek filtreler. Varsayılan: yok. */
  protected buildExtraFilters(_query: PaginationQueryDto): Record<string, unknown> {
    return {};
  }

  async findMany(
    query: PaginationQueryDto & { isActive?: boolean },
  ): Promise<PaginatedResult<TRecord>> {
    const search = this.queryBuilder.buildSearch(query.search, this.config.searchFields);

    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...this.buildExtraFilters(query),
      ...(search !== undefined && search),
    };

    const parts = this.queryBuilder.build(
      query,
      where,
      this.config.sortFields,
      this.config.defaultSortField,
    );

    const [items, total] = await this.prisma.$transaction([
      this.delegate.findMany({
        where: parts.where,
        skip: parts.skip,
        take: parts.take,
        orderBy: parts.orderBy,
      }) as unknown as Prisma.PrismaPromise<TRecord[]>,
      this.delegate.count({ where: parts.where }) as unknown as Prisma.PrismaPromise<number>,
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  /** Public liste: yalnız aktif kayıtlar, sıraya göre, sayfalamasız. */
  async findAllPublic(): Promise<TRecord[]> {
    return this.delegate.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }) as Promise<TRecord[]>;
  }

  async findOne(id: string): Promise<TRecord> {
    return this.getExisting(id);
  }

  async findBySlug(slug: string): Promise<TRecord> {
    const record = (await this.delegate.findFirst({
      where: { slug, deletedAt: null, isActive: true },
    })) as TRecord | null;

    if (record === null) {
      throw AppException.notFound(`${this.config.displayName} bulunamadı.`);
    }

    return record;
  }

  async create(dto: TCreateDto & { name: string }, actor: ActorContext): Promise<TRecord> {
    const slug = await this.slugService.generate(this.config.model, dto.name);

    return this.prisma.$transaction(async (tx) => {
      const delegate = tx[this.config.model] as unknown as GenericDelegate;

      const created = (await delegate.create({
        data: { ...this.toCreateData(dto), slug },
      })) as TRecord;

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: this.config.entityType,
        entityId: created.id,
        newData: created,
        description: `${this.config.displayName} oluşturuldu: ${created.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });
  }

  async update(
    id: string,
    dto: TUpdateDto & { name?: string },
    actor: ActorContext,
  ): Promise<TRecord> {
    const existing = await this.getExisting(id);

    // Slug yalnız ad DEĞİŞTİĞİNDE yeniden üretilir.
    //
    // Ad her güncellemede aynı gelse bile slug'ı yenilemek, kayıtlı
    // bağlantıları (ve arama motoru indekslerini) sessizce kırardı.
    const shouldRegenerate = dto.name !== undefined && dto.name !== existing.name;
    const slug = shouldRegenerate
      ? await this.slugService.generate(this.config.model, dto.name as string, id)
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      const delegate = tx[this.config.model] as unknown as GenericDelegate;

      const updated = (await delegate.update({
        where: { id },
        data: { ...this.toUpdateData(dto), ...(slug !== undefined && { slug }) },
      })) as TRecord;

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: this.config.entityType,
        entityId: id,
        oldData: existing,
        newData: updated,
        description: `${this.config.displayName} güncellendi: ${updated.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Soft delete.
   *
   * HARD DELETE BİLİNÇLİ OLARAK YOKTUR: bu kayıtlara ürünler referans verir
   * (Sprint 4). Fiziksel silme, geçmiş satış kayıtlarındaki taksonomi
   * bilgisini kırardı. Kayıt `deletedAt` ile işaretlenir ve pasife alınır.
   */
  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExisting(id);

    await this.assertDeletable(existing);

    await this.prisma.$transaction(async (tx) => {
      const delegate = tx[this.config.model] as unknown as GenericDelegate;

      await delegate.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: this.config.entityType,
        entityId: id,
        oldData: existing,
        description: `${this.config.displayName} silindi: ${existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  /** Aktiflik durumunu değiştirir. */
  async setActive(id: string, isActive: boolean, actor: ActorContext): Promise<TRecord> {
    const existing = await this.getExisting(id);

    return this.prisma.$transaction(async (tx) => {
      const delegate = tx[this.config.model] as unknown as GenericDelegate;

      const updated = (await delegate.update({ where: { id }, data: { isActive } })) as TRecord;

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: this.config.entityType,
        entityId: id,
        oldData: { isActive: existing.isActive },
        newData: { isActive },
        description: `${this.config.displayName} ${isActive ? 'aktifleştirildi' : 'pasife alındı'}: ${existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Silinebilirlik kontrolü.
   *
   * Sprint 4'te ürün ilişkileri eklendiğinde alt sınıflar bunu ezerek
   * "bu kayda bağlı ürün var" kontrolü yapacak. Şimdilik serbest.
   */
  protected async assertDeletable(_record: TRecord): Promise<void> {
    return Promise.resolve();
  }

  protected async getExisting(id: string): Promise<TRecord> {
    const record = (await this.delegate.findFirst({
      where: { id, deletedAt: null },
    })) as TRecord | null;

    if (record === null) {
      throw AppException.notFound(`${this.config.displayName} bulunamadı.`);
    }

    return record;
  }

  /** Aynı ada sahip başka bir kayıt var mı? */
  protected async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const found = (await this.delegate.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    })) as { id: string } | null;

    if (found !== null) {
      throw new AppException(ERROR_CODES.CONFLICT, `Bu ad zaten kullanılıyor: ${name}`, 409, [
        { field: 'name', message: 'Bu ad zaten kullanılıyor.' },
      ]);
    }
  }
}
