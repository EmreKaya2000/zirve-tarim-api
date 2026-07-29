import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, type Category } from '@prisma/client';
import { ERROR_CODES, type PaginatedResult } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CategoryTreeNode,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

const ENTITY_TYPE = 'Category';
const DISPLAY_NAME = 'Kategori';

const SORT_FIELDS = ['sortOrder', 'name', 'createdAt', 'updatedAt'] as const;

/**
 * Azami hiyerarşi derinliği.
 *
 * Sınırsız derinlik teoride mümkün ama pratikte 5 seviyeden derin bir
 * ziraat kataloğu kullanılamaz hâle gelir; ayrıca döngü kontrolündeki
 * yürüyüşe üst sınır koyar (bozuk veriye karşı savunma).
 */
const MAX_DEPTH = 5;

/**
 * Kategori yönetimi.
 *
 * Diğer taksonomilerden ayrılır çünkü HİYERARŞİKTİR: ağaç kurma, döngü
 * engeli ve derinlik sınırı gerektirir. Bu yüzden `LookupCrudService`
 * kullanmaz, kendi mantığını taşır.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slugService: SlugService,
    private readonly queryBuilder: QueryBuilderService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany(query: ListCategoriesQueryDto): Promise<PaginatedResult<Category>> {
    const search = this.queryBuilder.buildSearch(query.search, ['name', 'description']);

    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.parentId !== undefined && { parentId: query.parentId }),
      ...(query.rootOnly === 'true' && { parentId: null }),
      ...(search !== undefined && search),
    };

    const parts = this.queryBuilder.build(query, where, SORT_FIELDS, 'sortOrder');

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where: parts.where,
        skip: parts.skip,
        take: parts.take,
        orderBy: parts.orderBy,
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { children: true } },
        },
      }),
      this.prisma.category.count({ where: parts.where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  /**
   * Tüm kategorileri hiyerarşik ağaç olarak döner.
   *
   * Tek sorguyla tüm kayıtlar çekilip ağaç BELLEKTE kurulur. Özyinelemeli
   * sorgu (her düğüm için ayrı SELECT) N+1 üretirdi; taksonomi tablosu
   * küçük olduğu için tek seferde çekmek hem basit hem hızlıdır.
   *
   * @param onlyActive Public tarafta yalnız aktif kategoriler görünür.
   */
  async getTree(onlyActive: boolean): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null, ...(onlyActive && { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        description: true,
        icon: true,
        imageUrl: true,
        sortOrder: true,
        isActive: true,
      },
    });

    return buildTree(categories);
  }

  /** Kategorinin kökten kendisine kadar olan yolu (breadcrumb). */
  async getBreadcrumb(id: string): Promise<{ id: string; name: string; slug: string }[]> {
    const path: { id: string; name: string; slug: string }[] = [];
    let currentId: string | null = id;

    // MAX_DEPTH + 1 ile sınırlı: bozuk veride sonsuz döngüye girmez.
    for (let step = 0; step <= MAX_DEPTH && currentId !== null; step += 1) {
      const node: { id: string; name: string; slug: string; parentId: string | null } | null =
        await this.prisma.category.findFirst({
          where: { id: currentId, deletedAt: null },
          select: { id: true, name: true, slug: true, parentId: true },
        });

      if (node === null) {
        break;
      }

      path.unshift({ id: node.id, name: node.name, slug: node.slug });
      currentId = node.parentId;
    }

    return path;
  }

  async findOne(id: string): Promise<Category> {
    return this.getExisting(id);
  }

  async findBySlug(slug: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { slug, deletedAt: null, isActive: true },
    });

    if (category === null) {
      throw AppException.notFound('Kategori bulunamadı.');
    }

    return category;
  }

  async create(dto: CreateCategoryDto, actor: ActorContext): Promise<Category> {
    if (dto.parentId !== undefined) {
      await this.assertParentExists(dto.parentId);
      await this.assertDepthAllowed(dto.parentId);
    }

    const slug = await this.slugService.generate('category', dto.name);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          name: dto.name,
          slug,
          parentId: dto.parentId ?? null,
          description: dto.description ?? null,
          icon: dto.icon ?? null,
          imageUrl: dto.imageUrl ?? null,
          metaTitle: dto.metaTitle ?? null,
          metaDesc: dto.metaDesc ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: created,
        description: `${DISPLAY_NAME} oluşturuldu: ${created.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });
  }

  async update(id: string, dto: UpdateCategoryDto, actor: ActorContext): Promise<Category> {
    const existing = await this.getExisting(id);

    // parentId ALANIN VARLIĞI ile kontrol edilir: `null` göndermek "köke
    // taşı" demektir ve geçerli bir istektir; `undefined` ise "dokunma".
    const isMoving = 'parentId' in dto;

    if (isMoving && dto.parentId !== null && dto.parentId !== undefined) {
      await this.assertParentExists(dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
      await this.assertDepthAllowed(dto.parentId, id);
    }

    const shouldRegenerateSlug = dto.name !== undefined && dto.name !== existing.name;
    const slug = shouldRegenerateSlug
      ? await this.slugService.generate('category', dto.name as string, id)
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(slug !== undefined && { slug }),
          ...(isMoving && { parentId: dto.parentId ?? null }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
          ...(dto.metaDesc !== undefined && { metaDesc: dto.metaDesc }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: existing,
        newData: updated,
        description: `${DISPLAY_NAME} güncellendi: ${updated.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  async setActive(id: string, isActive: boolean, actor: ActorContext): Promise<Category> {
    const existing = await this.getExisting(id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data: { isActive } });

      // Pasife alınan kategorinin alt ağacı da pasife alınır: aktif bir alt
      // kategorinin pasif bir üst kategori altında görünmesi tutarsız olurdu.
      if (!isActive) {
        const descendantIds = await this.collectDescendantIds(id);

        if (descendantIds.length > 0) {
          await tx.category.updateMany({
            where: { id: { in: descendantIds } },
            data: { isActive: false },
          });
        }
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { isActive: existing.isActive },
        newData: { isActive },
        description: `${DISPLAY_NAME} ${isActive ? 'aktifleştirildi' : 'pasife alındı'}: ${existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Soft delete.
   *
   * Altında (silinmemiş) kategori varsa reddedilir — K-03. Ürün kontrolü
   * Sprint 4'te ürün tablosu geldiğinde eklenecektir.
   */
  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExisting(id);

    const childCount = await this.prisma.category.count({
      where: { parentId: id, deletedAt: null },
    });

    if (childCount > 0) {
      throw new AppException(
        ERROR_CODES.CONFLICT,
        `Bu kategorinin altında ${childCount} alt kategori var. Önce onları taşıyın veya silin.`,
        409,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: existing,
        description: `${DISPLAY_NAME} silindi: ${existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  private async getExisting(id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });

    if (category === null) {
      throw AppException.notFound('Kategori bulunamadı.');
    }

    return category;
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });

    if (parent === null) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 'Üst kategori bulunamadı.', 404, [
        { field: 'parentId', message: 'Üst kategori bulunamadı.' },
      ]);
    }
  }

  /**
   * DÖNGÜ ENGELİ (K-04).
   *
   * Bir kategori kendisinin veya kendi alt ağacındaki bir düğümün altına
   * taşınamaz — bu, ağacı birbirine bağlı bir halkaya çevirir ve ağaç kurma,
   * breadcrumb, listeleme gibi her işlemi sonsuz döngüye sokar.
   *
   * Kontrol, hedef üstten KÖKE doğru yürüyerek yapılır: yol üzerinde
   * taşınan kategorinin kendisi görünüyorsa döngü oluşur.
   */
  private async assertNoCycle(categoryId: string, newParentId: string): Promise<void> {
    if (categoryId === newParentId) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Bir kategori kendisinin altına taşınamaz.',
        422,
        [{ field: 'parentId', message: 'Bir kategori kendisinin altına taşınamaz.' }],
      );
    }

    let currentId: string | null = newParentId;
    let steps = 0;

    while (currentId !== null && steps <= MAX_DEPTH + 1) {
      if (currentId === categoryId) {
        throw new AppException(
          ERROR_CODES.UNPROCESSABLE,
          'Bir kategori kendi alt kategorilerinden birinin altına taşınamaz.',
          422,
          [
            {
              field: 'parentId',
              message: 'Bu taşıma kategori ağacında döngü oluşturur.',
            },
          ],
        );
      }

      const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });

      currentId = parent?.parentId ?? null;
      steps += 1;
    }
  }

  /** Yeni konumun derinlik sınırını aşıp aşmadığını kontrol eder. */
  private async assertDepthAllowed(parentId: string, movingCategoryId?: string): Promise<void> {
    const parentDepth = await this.getDepth(parentId);
    const subtreeHeight =
      movingCategoryId === undefined ? 0 : await this.getSubtreeHeight(movingCategoryId);

    // parentDepth + 1 (kategorinin kendisi) + alt ağacının yüksekliği
    if (parentDepth + 1 + subtreeHeight >= MAX_DEPTH) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        `Kategori hiyerarşisi en fazla ${MAX_DEPTH} seviye olabilir.`,
        422,
        [{ field: 'parentId', message: `En fazla ${MAX_DEPTH} seviye derinlik desteklenir.` }],
      );
    }
  }

  /** Kategorinin kökten uzaklığı (kök = 0). */
  private async getDepth(id: string): Promise<number> {
    let depth = 0;
    let currentId: string | null = id;

    while (currentId !== null && depth <= MAX_DEPTH + 1) {
      const node: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });

      currentId = node?.parentId ?? null;

      if (currentId !== null) {
        depth += 1;
      }
    }

    return depth;
  }

  /** Alt ağacın yüksekliği (yaprak = 0). */
  private async getSubtreeHeight(id: string): Promise<number> {
    const children = await this.prisma.category.findMany({
      where: { parentId: id, deletedAt: null },
      select: { id: true },
    });

    if (children.length === 0) {
      return 0;
    }

    const heights = await Promise.all(children.map((child) => this.getSubtreeHeight(child.id)));

    return 1 + Math.max(...heights);
  }

  /** Alt ağaçtaki tüm kategori id'lerini toplar. */
  private async collectDescendantIds(id: string): Promise<string[]> {
    const children = await this.prisma.category.findMany({
      where: { parentId: id, deletedAt: null },
      select: { id: true },
    });

    const nested = await Promise.all(children.map((child) => this.collectDescendantIds(child.id)));

    return [...children.map((child) => child.id), ...nested.flat()];
  }
}

/** Ağaç kurulumuna girdi olan düz kayıt. */
interface FlatCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Düz listeden ağaç kurar. Tek geçiş, O(n).
 *
 * Üst kategorisi listede BULUNMAYAN düğümler (ör. public listede üstü pasif
 * olduğu için elenmiş) köke alınmaz — görünmez bir üstün altındaki kategori
 * public tarafta gösterilmemelidir.
 */
export function buildTree(categories: FlatCategory[]): CategoryTreeNode[] {
  const nodeById = new Map<string, CategoryTreeNode>();

  for (const category of categories) {
    nodeById.set(category.id, {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      icon: category.icon,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      depth: 0,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];

  for (const category of categories) {
    const node = nodeById.get(category.id);

    if (node === undefined) {
      continue;
    }

    if (category.parentId === null) {
      roots.push(node);
      continue;
    }

    const parent = nodeById.get(category.parentId);

    // Üstü listede yoksa düğüm tamamen dışarıda bırakılır.
    if (parent !== undefined) {
      parent.children.push(node);
    }
  }

  assignDepth(roots, 0);

  return roots;
}

/** Ağaçta her düğüme derinliğini yazar. */
function assignDepth(nodes: CategoryTreeNode[], depth: number): void {
  for (const node of nodes) {
    node.depth = depth;
    assignDepth(node.children, depth + 1);
  }
}
