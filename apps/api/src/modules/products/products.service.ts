import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ERROR_CODES, type PaginatedResult } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { SlugService } from '../../common/services/slug.service';
import { slugify } from '../../common/utils/slug.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductVariantsService } from '../product-variants/product-variants.service';
import {
  ADMIN_PRODUCT_DETAIL_SELECT,
  ADMIN_PRODUCT_LIST_SELECT,
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
  stripHiddenPrices,
} from './products.select';
import {
  ADMIN_PRODUCT_SORT_FIELDS,
  type CreateProductDto,
  type ListProductsQueryDto,
  type ProductCategoryInputDto,
  type PublicProductQueryDto,
  type UpdateProductDto,
} from './dto/product.dto';

const ENTITY_TYPE = 'Product';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slugService: SlugService,
    private readonly queryBuilder: QueryBuilderService,
    private readonly auditLogs: AuditLogsService,
    private readonly categories: CategoriesService,
    private readonly variants: ProductVariantsService,
  ) {}

  // ==========================================================================
  // YÖNETİM
  // ==========================================================================

  async findManyAdmin(query: ListProductsQueryDto): Promise<PaginatedResult<unknown>> {
    // Yönetim aramasında da normalleştirilmiş kolon kullanılır: yönetici de
    // "gubre" yazıp "Gübre" ürününü bulabilmelidir.
    const normalizedSearch =
      query.search === undefined || query.search.trim() === ''
        ? undefined
        : slugify(query.search, 200);
    const search =
      normalizedSearch === undefined || normalizedSearch.length === 0
        ? undefined
        : { searchText: { contains: normalizedSearch } };

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.isPublished !== undefined && { isPublished: query.isPublished }),
      ...(query.brandId !== undefined && { brandId: query.brandId }),
      ...(query.categoryId !== undefined && {
        categories: { some: { categoryId: query.categoryId } },
      }),
      // Stok eşiğinin altındaki varyasyonu olan ürünler.
      // Prisma iki kolonu doğrudan karşılaştıramadığı için ham SQL alt sorgusu
      // yerine `lowStockThreshold`'u aşan kayıtlar uygulama tarafında değil
      // burada `AND` ile kurulur; eşik 0 ise kıyas anlamsızdır.
      ...(query.lowStock === true && {
        variants: {
          some: {
            deletedAt: null,
            isActive: true,
            trackStock: true,
            lowStockThreshold: { gt: 0 },
          },
        },
      }),
      ...(search ?? {}),
    };

    const parts = this.queryBuilder.build(query, where, ADMIN_PRODUCT_SORT_FIELDS, 'createdAt');

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where: parts.where,
        skip: parts.skip,
        take: parts.take,
        orderBy: parts.orderBy,
        select: ADMIN_PRODUCT_LIST_SELECT,
      }),
      this.prisma.product.count({ where: parts.where }),
    ]);

    // `lowStock` gerçek karşılaştırmayı burada yapar: Prisma iki kolonu
    // (stockQuantity <= lowStockThreshold) tek sorguda kıyaslayamaz.
    const filtered =
      query.lowStock === true
        ? items.filter((product) =>
            product.variants.some(
              (variant) =>
                Number(variant.stockQuantity) <= Number(variant.lowStockThreshold) &&
                Number(variant.lowStockThreshold) > 0,
            ),
          )
        : items;

    return { items: filtered, meta: this.queryBuilder.buildMeta(total, query) };
  }

  async findOneAdmin(id: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: ADMIN_PRODUCT_DETAIL_SELECT,
    });

    if (product === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }

    return product;
  }

  async create(dto: CreateProductDto, actor: ActorContext): Promise<unknown> {
    this.assertSinglePrimaryCategory(dto.categories);
    await this.assertCategoriesExist(dto.categories.map((item) => item.categoryId));
    assertUniqueSkusWithinRequest(dto.variants);

    /*
     * EN AZ BİR AKTİF VARYASYON — ürün oluşturmanın ön koşulu (SPEC §15.3).
     *
     * DTO en az bir varyasyon geldiğini garanti eder ama hepsi `isActive: false`
     * olabilir; o durumda ürün yine satılamaz olurdu. Kural bu yüzden ADET
     * değil AKTİFLİK üzerinden kontrol edilir.
     *
     * Kural eskiden yalnız YAYINA ALIRKEN bakılıyordu; varyasyonsuz ürün
     * oluşturulabiliyor, sonra sessizce katalogda duruyordu. Artık değişmez:
     * satılabilir olmayan bir ürün kaydı hiç doğmaz.
     */
    const hasActiveVariant = dto.variants.some((variant) => variant.isActive !== false);

    if (!hasActiveVariant) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Ürünün en az bir AKTİF varyasyonu olmalıdır.',
        422,
        [
          {
            field: 'variants',
            message: 'Gönderilen varyasyonların tamamı pasif. En az biri aktif olmalıdır.',
          },
        ],
      );
    }

    const slug = await this.slugService.generate('product', dto.name);
    const brandName = await this.getBrandName(dto.brandId);

    const productId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: dto.name,
          slug,
          shortDescription: dto.shortDescription ?? null,
          description: dto.description ?? null,
          brandId: dto.brandId ?? null,
          usageInstructions: dto.usageInstructions ?? null,
          ingredients: dto.ingredients ?? null,
          storageConditions: dto.storageConditions ?? null,
          licenseNumber: dto.licenseNumber ?? null,
          isActive: dto.isActive ?? true,
          // Varsayılan YAYINLANMAMIŞTIR. Aktif varyasyon şartı yukarıda zaten
          // sağlandığı için yöneticinin yayın tercihine doğrudan uyulur.
          isPublished: dto.isPublished ?? false,
          showPrice: dto.showPrice ?? true,
          isFeatured: dto.isFeatured ?? false,
          isNew: dto.isNew ?? false,
          isPopular: dto.isPopular ?? false,
          metaTitle: dto.metaTitle ?? null,
          metaDesc: dto.metaDesc ?? null,
          sortOrder: dto.sortOrder ?? 0,
          searchText: buildSearchText({
            name: dto.name,
            shortDescription: dto.shortDescription,
            ingredients: dto.ingredients,
            brandName,
          }),
          categories: {
            create: dto.categories.map((item) => ({
              categoryId: item.categoryId,
              isPrimary: item.isPrimary ?? false,
            })),
          },
        },
        select: { id: true, name: true },
      });

      await this.syncTaxonomies(tx, created.id, dto);

      /*
       * Varyasyonlar ÜRÜNLE AYNI TRANSACTION'DA yazılır.
       *
       * Biri geçersizse (SKU çakışması, "adet" biriminde ondalık miktar,
       * negatif fiyat) transaction geri alınır ve ürün de kaydedilmez.
       * İstemcide sırayla POST edilseydi, ikinci varyasyonun hatası
       * varyasyonsuz — yani satılamaz — bir ürün bırakırdı.
       *
       * SIRALI yazılır, `Promise.all` ile DEĞİL: `isDefault` temizliği ve
       * "ilk varyasyon varsayılan olur" kuralı bir önceki kaydın durumunu
       * okur; paralel çalışsalar hangisinin varsayılan olacağı yarışa kalırdı.
       */
      for (const [index, variant] of (dto.variants ?? []).entries()) {
        await this.variants.createInTransaction(
          tx,
          created.id,
          // Sıra korunur: yöneticinin formda dizdiği düzen listelemeye yansır.
          { ...variant, sortOrder: variant.sortOrder ?? index },
          actor,
        );
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: { name: created.name, slug, variantCount: (dto.variants ?? []).length },
        description: `Ürün oluşturuldu: ${created.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created.id;
    });

    return this.findOneAdmin(productId);
  }

  async update(id: string, dto: UpdateProductDto, actor: ActorContext): Promise<unknown> {
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        isPublished: true,
        shortDescription: true,
        ingredients: true,
        brandId: true,
      },
    });

    if (existing === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }

    if (dto.categories !== undefined) {
      this.assertSinglePrimaryCategory(dto.categories);
      await this.assertCategoriesExist(dto.categories.map((item) => item.categoryId));
    }

    // Yayına alma en az bir AKTİF varyasyon gerektirir (SPEC §15).
    if (dto.isPublished === true) {
      await this.assertHasActiveVariant(id);
    }

    const shouldRegenerateSlug = dto.name !== undefined && dto.name !== existing.name;
    const slug = shouldRegenerateSlug
      ? await this.slugService.generate('product', dto.name as string, id)
      : undefined;

    // Aramada kullanılan alanlardan biri değiştiyse searchText yenilenir.
    const brandName = await this.getBrandName(
      'brandId' in dto ? (dto.brandId ?? undefined) : (existing.brandId ?? undefined),
    );
    const searchText = buildSearchText({
      name: dto.name ?? existing.name,
      shortDescription: dto.shortDescription ?? existing.shortDescription ?? undefined,
      ingredients: dto.ingredients ?? existing.ingredients ?? undefined,
      brandName,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          searchText,
          ...(dto.name !== undefined && { name: dto.name }),
          ...(slug !== undefined && { slug }),
          ...(dto.shortDescription !== undefined && { shortDescription: dto.shortDescription }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...('brandId' in dto && { brandId: dto.brandId ?? null }),
          ...(dto.usageInstructions !== undefined && {
            usageInstructions: dto.usageInstructions,
          }),
          ...(dto.ingredients !== undefined && { ingredients: dto.ingredients }),
          ...(dto.storageConditions !== undefined && {
            storageConditions: dto.storageConditions,
          }),
          ...(dto.licenseNumber !== undefined && { licenseNumber: dto.licenseNumber }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
          ...(dto.showPrice !== undefined && { showPrice: dto.showPrice }),
          ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
          ...(dto.isNew !== undefined && { isNew: dto.isNew }),
          ...(dto.isPopular !== undefined && { isPopular: dto.isPopular }),
          ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
          ...(dto.metaDesc !== undefined && { metaDesc: dto.metaDesc }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      });

      // Kategoriler gönderildiyse TAMAMEN değiştirilir.
      //
      // Kısmi güncelleme (ekle/çıkar) uçları ayrı olmadığı için "gönderilen
      // liste = son durum" sözleşmesi seçildi; formun davranışıyla birebir
      // örtüşür ve iki kaynaklı gerçek oluşmaz.
      if (dto.categories !== undefined) {
        await tx.productCategory.deleteMany({ where: { productId: id } });
        await tx.productCategory.createMany({
          data: dto.categories.map((item) => ({
            productId: id,
            categoryId: item.categoryId,
            isPrimary: item.isPrimary ?? false,
          })),
        });
      }

      await this.syncTaxonomies(tx, id, dto);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: existing,
        newData: { name: dto.name ?? existing.name },
        description: `Ürün güncellendi: ${dto.name ?? existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOneAdmin(id);
  }

  /** Soft delete. Ürün kaydı korunur; geçmiş satış satırları kırılmaz. */
  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });

    if (existing === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, isPublished: false },
      });

      // Varyasyonlar da pasife alınır: aktif varyasyonu olan silinmiş bir
      // ürün, stok raporlarında hayalet kayıt üretirdi.
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: existing,
        description: `Ürün silindi: ${existing.name}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  // ==========================================================================
  // PUBLIC
  // ==========================================================================

  async findManyPublic(query: PublicProductQueryDto): Promise<PaginatedResult<unknown>> {
    const where = await this.buildPublicWhere(query);
    const { skip, take } = { skip: (query.page - 1) * query.limit, take: query.limit };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: buildPublicOrderBy(query.sort),
        select: PUBLIC_PRODUCT_LIST_SELECT,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map(stripHiddenPrices),
      meta: this.queryBuilder.buildMeta(total, query),
    };
  }

  async findBySlugPublic(slug: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null, isActive: true, isPublished: true },
      select: PUBLIC_PRODUCT_DETAIL_SELECT,
    });

    if (product === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }

    // Görüntülenme sayacı yanıtı bekletmeden artırılır: sayaç kaybı
    // kullanıcıya hata göstermekten iyidir.
    void this.prisma.product
      .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return stripHiddenPrices(product);
  }

  /** Public ürün filtresini kurar. */
  private async buildPublicWhere(query: PublicProductQueryDto): Promise<Prisma.ProductWhereInput> {
    const conditions: Prisma.ProductWhereInput[] = [
      { deletedAt: null, isActive: true, isPublished: true },
    ];

    // Kategori: ALT KATEGORİLER DE dahil edilir. "Gübre" seçen kullanıcı
    // "Sıvı Gübre" ürünlerini de görmeyi bekler.
    if (query.category !== undefined) {
      const categoryIds = await this.resolveCategoryWithDescendants(query.category);

      conditions.push({ categories: { some: { categoryId: { in: categoryIds } } } });
    }

    const brandSlugs = splitSlugs(query.brand);
    if (brandSlugs.length > 0) {
      conditions.push({ brand: { slug: { in: brandSlugs } } });
    }

    const plantSlugs = splitSlugs(query.plant);
    if (plantSlugs.length > 0) {
      conditions.push({ plants: { some: { plant: { slug: { in: plantSlugs } } } } });
    }

    const soilSlugs = splitSlugs(query.soilType);
    if (soilSlugs.length > 0) {
      conditions.push({ soilTypes: { some: { soilType: { slug: { in: soilSlugs } } } } });
    }

    const unitCodes = splitSlugs(query.unit);
    if (unitCodes.length > 0) {
      conditions.push({
        variants: {
          some: { isActive: true, deletedAt: null, unitType: { code: { in: unitCodes } } },
        },
      });
    }

    if (query.inStock === true) {
      conditions.push({
        variants: { some: { isActive: true, deletedAt: null, stockQuantity: { gt: 0 } } },
      });
    }

    if (query.featured === true) {
      conditions.push({ isFeatured: true });
    }

    // Fiyat aralığı: string olarak gelir, Decimal'e çevrilir (Kural 2).
    //
    // Filtre VARYASYON üzerinden kurulur, türetilmiş minSalePrice üzerinden
    // değil: "100-200 TL arası" arayan kullanıcı, 50 TL'lik küçük ambalajı
    // da olan ama 150 TL'lik ambalajı bulunan ürünü görmek ister.
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      conditions.push({
        variants: {
          some: {
            isActive: true,
            deletedAt: null,
            salePrice: {
              ...(query.minPrice !== undefined && { gte: new Prisma.Decimal(query.minPrice) }),
              ...(query.maxPrice !== undefined && { lte: new Prisma.Decimal(query.maxPrice) }),
            },
          },
        },
      });
    }

    // Arama NORMALLEŞTİRİLMİŞ kolon üzerinden yapılır: "gubre" araması
    // "Gübre" ürününü bulur. Terim de aynı işlevden geçirilir.
    const search = query.search?.trim();
    if (search !== undefined && search.length > 0) {
      const normalized = slugify(search, 200);

      if (normalized.length > 0) {
        conditions.push({ searchText: { contains: normalized } });
      }
    }

    return { AND: conditions };
  }

  /** Kategori slug'ından kendisi + tüm alt kategorilerinin id'lerini üretir. */
  private async resolveCategoryWithDescendants(slug: string): Promise<string[]> {
    const category = await this.prisma.category.findFirst({
      where: { slug, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (category === null) {
      // Bilinmeyen kategori: boş sonuç döndürmek için eşleşmeyecek bir id.
      return ['00000000-0000-0000-0000-000000000000'];
    }

    const tree = await this.categories.getTree(true);
    const ids = collectCategoryIds(tree, category.id);

    return ids.length > 0 ? ids : [category.id];
  }

  /** İlgili ürünler — ilişki türüne göre. */
  async findRelated(productId: string, type?: string): Promise<unknown[]> {
    const relations = await this.prisma.productRelation.findMany({
      where: {
        ...(type !== undefined && { type: type as Prisma.EnumProductRelationTypeFilter['equals'] }),
        OR: [{ sourceProductId: productId }, { targetProductId: productId }],
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        type: true,
        note: true,
        sourceProductId: true,
        targetProductId: true,
      },
    });

    // YÖNLÜ ilişkilerde yalnız KAYNAK bu ürünse gösterilir: "A yerine B"
    // ilişkisi B'nin sayfasında "B yerine A" anlamına gelmez.
    const relevant = relations.filter((relation) => {
      const isSymmetric = ['COMPATIBLE', 'INCOMPATIBLE', 'SIMILAR'].includes(relation.type);

      return isSymmetric || relation.sourceProductId === productId;
    });

    const otherIds = relevant.map((relation) =>
      relation.sourceProductId === productId ? relation.targetProductId : relation.sourceProductId,
    );

    if (otherIds.length === 0) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: otherIds }, deletedAt: null, isActive: true, isPublished: true },
      select: PUBLIC_PRODUCT_LIST_SELECT,
    });

    const byId = new Map(products.map((product) => [product.id, stripHiddenPrices(product)]));

    return relevant
      .map((relation) => {
        const otherId =
          relation.sourceProductId === productId
            ? relation.targetProductId
            : relation.sourceProductId;
        const product = byId.get(otherId);

        return product === undefined
          ? undefined
          : { type: relation.type, note: relation.note, product };
      })
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
  }

  // ==========================================================================
  // İŞ KURALLARI
  // ==========================================================================

  /** Ürün başına yalnız BİR ana kategori olabilir (SPEC §15). */
  private assertSinglePrimaryCategory(categories: ProductCategoryInputDto[]): void {
    const primaryCount = categories.filter((item) => item.isPrimary === true).length;

    if (primaryCount > 1) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Yalnızca bir kategori ana kategori olarak işaretlenebilir.',
        422,
        [{ field: 'categories', message: 'Birden fazla ana kategori seçilemez.' }],
      );
    }

    const uniqueIds = new Set(categories.map((item) => item.categoryId));

    if (uniqueIds.size !== categories.length) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Aynı kategori birden fazla kez eklenemez.',
        422,
        [{ field: 'categories', message: 'Yinelenen kategori.' }],
      );
    }
  }

  /** Marka adını arama metnine katmak için getirir. */
  private async getBrandName(brandId: string | undefined): Promise<string | undefined> {
    if (brandId === undefined) {
      return undefined;
    }

    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { name: true },
    });

    return brand?.name;
  }

  private async assertCategoriesExist(categoryIds: string[]): Promise<void> {
    const found = await this.prisma.category.count({
      where: { id: { in: categoryIds }, deletedAt: null },
    });

    if (found !== categoryIds.length) {
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        'Seçilen kategorilerden biri bulunamadı.',
        404,
        [{ field: 'categories', message: 'Geçersiz kategori.' }],
      );
    }
  }

  /** Yayına alma için en az bir aktif varyasyon gerekir (SPEC §15). */
  private async assertHasActiveVariant(productId: string): Promise<void> {
    const activeVariants = await this.prisma.productVariant.count({
      where: { productId, isActive: true, deletedAt: null },
    });

    if (activeVariants === 0) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Ürünü yayınlamak için en az bir aktif varyasyon gerekir.',
        422,
        [{ field: 'isPublished', message: 'Önce bir varyasyon ekleyin.' }],
      );
    }
  }

  /**
   * Taksonomi bağlantılarını eşitler.
   *
   * Gönderilen liste SON DURUMDUR: eski bağlantılar silinip yenileri yazılır.
   * Alan hiç gönderilmediyse (`undefined`) o ilişkiye DOKUNULMAZ.
   */
  private async syncTaxonomies(
    tx: Prisma.TransactionClient,
    productId: string,
    dto: CreateProductDto | UpdateProductDto,
  ): Promise<void> {
    if (dto.plants !== undefined) {
      await tx.productPlant.deleteMany({ where: { productId } });
      if (dto.plants.length > 0) {
        await tx.productPlant.createMany({
          data: dto.plants.map((item) => ({
            productId,
            plantId: item.id,
            note: item.note ?? null,
          })),
        });
      }
    }

    if (dto.soilTypes !== undefined) {
      await tx.productSoilType.deleteMany({ where: { productId } });
      if (dto.soilTypes.length > 0) {
        await tx.productSoilType.createMany({
          data: dto.soilTypes.map((item) => ({
            productId,
            soilTypeId: item.id,
            note: item.note ?? null,
          })),
        });
      }
    }

    if (dto.benefits !== undefined) {
      await tx.productBenefit.deleteMany({ where: { productId } });
      if (dto.benefits.length > 0) {
        await tx.productBenefit.createMany({
          data: dto.benefits.map((item, index) => ({
            productId,
            benefitId: item.id,
            note: item.note ?? null,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
    }

    if (dto.sideEffects !== undefined) {
      await tx.productSideEffect.deleteMany({ where: { productId } });
      if (dto.sideEffects.length > 0) {
        await tx.productSideEffect.createMany({
          data: dto.sideEffects.map((item, index) => ({
            productId,
            sideEffectId: item.id,
            note: item.note ?? null,
            severityOverride: item.severityOverride ?? null,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
    }

    if (dto.usagePeriods !== undefined) {
      await tx.productUsagePeriod.deleteMany({ where: { productId } });
      if (dto.usagePeriods.length > 0) {
        await tx.productUsagePeriod.createMany({
          data: dto.usagePeriods.map((item) => ({
            productId,
            usagePeriodId: item.id,
            note: item.note ?? null,
          })),
        });
      }
    }
  }
}

/**
 * Aranabilir metni normalleştirir.
 *
 * `slugify` Türkçe karakterleri açık eşleme tablosuyla dönüştürür (ı→i,
 * ş→s, ğ→g...). Aynı işlev arama TERİMİNE de uygulandığı için aksanlı ve
 * aksansız yazımlar eşleşir.
 */
function buildSearchText(parts: {
  name: string;
  shortDescription?: string;
  ingredients?: string;
  brandName?: string;
}): string {
  return [parts.name, parts.shortDescription, parts.ingredients, parts.brandName]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .map((value) => slugify(value, 2000))
    .join(' ');
}

/** Virgülle ayrılmış slug listesini diziye çevirir. */
function splitSlugs(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Public sıralama seçeneğini Prisma orderBy'a çevirir. */
function buildPublicOrderBy(
  sort: string,
): Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'name-asc':
      return { name: 'asc' };
    case 'name-desc':
      return { name: 'desc' };
    case 'featured':
      return [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }];
    case 'price-asc':
      // Türetilmiş `minSalePrice` üzerinden sıralanır (ProductPricingService).
      // Fiyatsız ürünler (aktif varyasyonu olmayan) sona alınır.
      return [{ minSalePrice: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }];
    case 'price-desc':
      return [{ minSalePrice: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
}

/**
 * Aynı istekte gelen varyasyonların SKU'ları birbirinden farklı olmalıdır.
 *
 * Veritabanı kısıtı bunu zaten yakalar ama hata mesajı hangi SATIRIN
 * çakıştığını söylemez. Kullanıcı yedi sekmeli formu doldurup kaydettiğinde
 * "SKU zaten kullanılıyor" mesajı alıp bunun kendi listesindeki iki satır
 * olduğunu anlamak zorunda kalmasın: çakışan SKU açıkça bildirilir.
 */
function assertUniqueSkusWithinRequest(variants: { sku: string }[] | undefined): void {
  const seen = new Set<string>();

  for (const variant of variants ?? []) {
    // SKU büyük/küçük harf duyarsız karşılaştırılır: "abc-1" ve "ABC-1" aynı
    // koddur ve ikisi birden gönderilirse ikincisi kısıta takılırdı.
    const key = variant.sku.toUpperCase();

    if (seen.has(key)) {
      throw new AppException(
        ERROR_CODES.CONFLICT,
        `Varyasyon listesinde tekrar eden SKU var: ${variant.sku}`,
        409,
        [{ field: 'variants', message: 'Her varyasyonun SKU değeri farklı olmalıdır.' }],
      );
    }

    seen.add(key);
  }
}

/** Ağaçtan bir kategori ve tüm alt kategorilerinin id'lerini toplar. */
function collectCategoryIds(
  nodes: { id: string; children: { id: string; children: unknown[] }[] }[],
  rootId: string,
): string[] {
  for (const node of nodes) {
    if (node.id === rootId) {
      const ids: string[] = [];
      const walk = (current: { id: string; children: unknown[] }): void => {
        ids.push(current.id);
        (current.children as { id: string; children: unknown[] }[]).forEach(walk);
      };
      walk(node);

      return ids;
    }

    const found = collectCategoryIds(
      node.children as { id: string; children: { id: string; children: unknown[] }[] }[],
      rootId,
    );

    if (found.length > 0) {
      return found;
    }
  }

  return [];
}
