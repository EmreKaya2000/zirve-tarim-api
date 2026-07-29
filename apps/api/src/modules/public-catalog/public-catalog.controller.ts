import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { ProductsService } from '../products/products.service';
import { PublicProductQueryDto } from '../products/dto/product.dto';
import { BenefitsService } from '../benefits/benefits.service';
import { BrandsService } from '../brands/brands.service';
import { CategoriesService } from '../categories/categories.service';
import { PlantsService } from '../plants/plants.service';
import { SettingsService, type PublicSetting } from '../settings/settings.service';
import { SideEffectsService } from '../side-effects/side-effects.service';
import { SoilTypesService } from '../soil-types/soil-types.service';
import { UnitTypesService } from '../unit-types/unit-types.service';
import { UsagePeriodsService } from '../usage-periods/usage-periods.service';
import type { CategoryTreeNode } from '../categories/dto/category.dto';

/** Public uçlar için genel limit. Katalog gezinmesi yoğun olabilir. */
const PUBLIC_THROTTLE = { default: { limit: 120, ttl: 60_000 } };

/**
 * Public katalog taksonomisi.
 *
 * KURAL 8: Bu uçların hiçbiri hassas alan döndürmez. Taksonomi tabloları
 * zaten fiyat/maliyet taşımaz; buradaki asıl kural yalnız AKTİF ve
 * SİLİNMEMİŞ kayıtların dönmesidir — pasif bir kategori public tarafta
 * görünmemelidir.
 *
 * Listeler sayfalanmaz: taksonomi tabloları küçüktür (onlarca kayıt) ve
 * istemci bunları filtre menüsü kurmak için bir kerede ister.
 */
@ApiTags('Public — Katalog')
@Public()
@Throttle(PUBLIC_THROTTLE)
@Controller('public')
export class PublicCatalogController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly brands: BrandsService,
    private readonly plants: PlantsService,
    private readonly soilTypes: SoilTypesService,
    private readonly benefits: BenefitsService,
    private readonly sideEffects: SideEffectsService,
    private readonly usagePeriods: UsagePeriodsService,
    private readonly unitTypes: UnitTypesService,
    private readonly settings: SettingsService,
    private readonly products: ProductsService,
  ) {}

  // =========================================================================
  // ÜRÜNLER
  // =========================================================================

  @Get('products')
  @ApiOperation({
    summary: 'Ürünleri listele',
    description: [
      'Filtreler: kategori (ALT KATEGORİLER DAHİL), marka, bitki, toprak türü,',
      'birim, stokta olanlar, fiyat aralığı, öne çıkanlar ve serbest arama.',
      '',
      'Sıralama: newest | name-asc | name-desc | price-asc | price-desc | featured',
      '',
      'GÜVENLİK: Bu yanıtta `purchasePrice` ASLA bulunmaz. `showPrice=false`',
      'olan üründe `salePrice` de gizlenir (Kural 8).',
    ].join('\n'),
  })
  async getProducts(@Query() query: PublicProductQueryDto) {
    return this.products.findManyPublic(query);
  }

  @Get('products/:slug')
  @ApiParam({ name: 'slug', example: 'agromax-npk-20-20-20' })
  @ApiOperation({
    summary: 'Ürün detayı',
    description: 'Yalnız aktif ve YAYINLANMIŞ ürünler döner.',
  })
  async getProduct(@Param('slug') slug: string) {
    return this.products.findBySlugPublic(slug);
  }

  @Get('products/:slug/related')
  @ApiParam({ name: 'slug', example: 'agromax-npk-20-20-20' })
  @ApiQuery({ name: 'type', required: false, description: 'İlişki türüne göre süz.' })
  @ApiOperation({
    summary: 'İlgili ürünler',
    description: 'Simetrik ilişkiler iki yönden, yönlü ilişkiler yalnız kaynak taraftan döner.',
  })
  async getRelatedProducts(@Param('slug') slug: string, @Query('type') type?: string) {
    const product = (await this.products.findBySlugPublic(slug)) as { id: string };

    return this.products.findRelated(product.id, type);
  }

  @Get('categories/tree')
  @ApiOperation({
    summary: 'Kategori ağacı',
    description:
      'Yalnız aktif kategoriler. Üstü pasif olan alt kategoriler ağaçtan tamamen çıkarılır.',
  })
  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    return this.categories.getTree(true);
  }

  @Get('categories/:slug')
  @ApiParam({ name: 'slug', example: 'sivi-gubre' })
  @ApiOperation({ summary: 'Kategori detayı (slug ile)' })
  async getCategory(@Param('slug') slug: string) {
    const category = await this.categories.findBySlug(slug);
    const breadcrumb = await this.categories.getBreadcrumb(category.id);

    return { ...category, breadcrumb };
  }

  @Get('brands')
  @ApiOperation({ summary: 'Aktif markalar' })
  async getBrands() {
    return this.brands.findAllPublic();
  }

  @Get('brands/:slug')
  @ApiParam({ name: 'slug', example: 'agromax' })
  @ApiOperation({
    summary: 'Marka detayı (slug ile)',
    description: 'Marka sayfasının başlığı ve SEO üstverisi için. Pasif marka 404 döner.',
  })
  async getBrand(@Param('slug') slug: string) {
    return this.brands.findBySlug(slug);
  }

  @Get('plants')
  @ApiOperation({ summary: 'Aktif bitkiler' })
  async getPlants() {
    return this.plants.findAllPublic();
  }

  @Get('plants/:slug')
  @ApiParam({ name: 'slug', example: 'bugday' })
  @ApiOperation({
    summary: 'Bitki detayı (slug ile)',
    description: 'Bitki sayfasının başlığı ve SEO üstverisi için. Pasif bitki 404 döner.',
  })
  async getPlant(@Param('slug') slug: string) {
    return this.plants.findBySlug(slug);
  }

  @Get('soil-types')
  @ApiOperation({ summary: 'Aktif toprak türleri' })
  async getSoilTypes() {
    return this.soilTypes.findAllPublic();
  }

  @Get('benefits')
  @ApiOperation({ summary: 'Aktif yararlar' })
  async getBenefits() {
    return this.benefits.findAllPublic();
  }

  @Get('side-effects')
  @ApiOperation({ summary: 'Aktif yan etkiler' })
  async getSideEffects() {
    return this.sideEffects.findAllPublic();
  }

  @Get('usage-periods')
  @ApiOperation({ summary: 'Aktif kullanım dönemleri', description: 'Takvimsel sıraya göre.' })
  async getUsagePeriods() {
    return this.usagePeriods.findAllPublic();
  }

  @Get('unit-types')
  @ApiOperation({ summary: 'Aktif ölçü birimleri' })
  async getUnitTypes() {
    return this.unitTypes.findAllPublic();
  }

  @Get('settings')
  @ApiOperation({
    summary: 'Public ayarlar',
    description:
      'Yalnız isPublic=true olan ayarlar döner (mağaza telefonu, adres, yasal uyarı metni vb.).',
  })
  async getSettings(): Promise<PublicSetting[]> {
    return this.settings.findPublic();
  }

  @Get('taxonomy')
  @ApiOperation({
    summary: 'Tüm taksonomi tek çağrıda',
    description:
      'Ürün listeleme sayfasının filtre menüsünü kurmak için gereken her şeyi tek istekte döner — mobilde ayrı ayrı çağırmak pahalıdır.',
  })
  async getTaxonomy(@Query('include') include?: string) {
    // `include` verilmezse tümü döner; verilirse yalnız istenen bölümler.
    const requested = include?.split(',').map((part) => part.trim());
    const wants = (key: string): boolean => requested === undefined || requested.includes(key);

    const [categories, brands, plants, soilTypes, benefits, usagePeriods, unitTypes] =
      await Promise.all([
        wants('categories') ? this.categories.getTree(true) : Promise.resolve(undefined),
        wants('brands') ? this.brands.findAllPublic() : Promise.resolve(undefined),
        wants('plants') ? this.plants.findAllPublic() : Promise.resolve(undefined),
        wants('soilTypes') ? this.soilTypes.findAllPublic() : Promise.resolve(undefined),
        wants('benefits') ? this.benefits.findAllPublic() : Promise.resolve(undefined),
        wants('usagePeriods') ? this.usagePeriods.findAllPublic() : Promise.resolve(undefined),
        wants('unitTypes') ? this.unitTypes.findAllPublic() : Promise.resolve(undefined),
      ]);

    return { categories, brands, plants, soilTypes, benefits, usagePeriods, unitTypes };
  }
}
