import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/actor-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ProductsService } from './products.service';

const HEADERS = [
  'Ürün Adı*',
  'Kısa Açıklama',
  'Açıklama',
  'Marka',
  'Kategori*',
  'SKU*',
  'Varyasyon Adı',
  'Birim*',
  'Birim Miktarı*',
  'Alış Fiyatı',
  'Satış Fiyatı',
  'KDV %',
  'Stok',
  'Kritik Stok',
  'Görsel URL’leri',
  'Yayında mı?',
];
type ImportResult = { created: number; failed: { row: number; message: string }[] };

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly uploads: UploadsService,
  ) {}

  async template(): Promise<Buffer> {
    const [brands, categories, units] = await Promise.all([
      this.prisma.brand.findMany({
        where: { deletedAt: null, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.findMany({
        where: { deletedAt: null, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unitType.findMany({
        where: { deletedAt: null, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Ürünler');
    const ref = book.addWorksheet('Referanslar');
    sheet.addRow(HEADERS);
    sheet.addRow([
      'Örnek ürün',
      '',
      '',
      brands[0]?.name ?? '',
      categories[0]?.name ?? '',
      'ORNEK-001',
      '',
      units[0]?.name ?? '',
      '1',
      '0',
      '0',
      '20',
      '0',
      '0',
      'https://ornek.com/gorsel.jpg',
      'Hayır',
    ]);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5D42' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns = HEADERS.map((header) => ({ width: Math.max(18, header.length + 3) }));
    sheet.getColumn(15).width = 42;
    ref.state = 'veryHidden';
    ref.getColumn(1).values = ['', ...brands.map((item) => item.name)];
    ref.getColumn(2).values = ['', ...categories.map((item) => item.name)];
    ref.getColumn(3).values = ['', ...units.map((item) => item.name)];
    ref.getColumn(4).values = ['', 'Evet', 'Hayır'];
    for (let row = 2; row <= 1001; row += 1) {
      sheet.getCell(row, 4).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'Referanslar'!$A$2:$A$${Math.max(2, brands.length + 1)}`],
      };
      sheet.getCell(row, 5).dataValidation = {
        type: 'list',
        formulae: [`'Referanslar'!$B$2:$B$${Math.max(2, categories.length + 1)}`],
      };
      sheet.getCell(row, 8).dataValidation = {
        type: 'list',
        formulae: [`'Referanslar'!$C$2:$C$${Math.max(2, units.length + 1)}`],
      };
      sheet.getCell(row, 16).dataValidation = {
        type: 'list',
        formulae: ["'Referanslar'!$D$2:$D$3"],
      };
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  async import(buffer: Buffer, actor: ActorContext): Promise<ImportResult> {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = book.worksheets[0];
    if (
      sheet === undefined ||
      HEADERS.some(
        (header, index) =>
          sheet
            .getRow(1)
            .getCell(index + 1)
            .text.trim() !== header,
      )
    )
      throw AppException.badRequest('Geçerli ürün içe aktarma şablonunu kullanın.');
    const [brands, categories, units] = await Promise.all([
      this.prisma.brand.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.category.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.unitType.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
    ]);
    const index = <T extends { name: string }>(items: T[]) =>
      new Map(items.map((item) => [item.name.toLocaleLowerCase('tr-TR'), item]));
    const brand = index(brands);
    const category = index(categories);
    const unit = index(units);
    const failed: ImportResult['failed'] = [];
    let created = 0;
    for (let n = 2; n <= sheet.rowCount; n += 1)
      try {
        const row = HEADERS.map((_, i) =>
          sheet
            .getRow(n)
            .getCell(i + 1)
            .text.trim(),
        );
        if (row.every((value) => value === '')) continue;
        const [
          name = '',
          shortDescription = '',
          description = '',
          brandName = '',
          categoryName = '',
          sku = '',
          variantName = '',
          unitName = '',
          unitQuantity = '',
          purchasePrice = '0',
          salePrice = '0',
          taxRate = '0',
          stockQuantity = '0',
          lowStockThreshold = '0',
          imageUrls = '',
          isPublished = 'Hayır',
        ] = row;
        const c = category.get(categoryName.toLocaleLowerCase('tr-TR'));
        const u = unit.get(unitName.toLocaleLowerCase('tr-TR'));
        const b = brandName === '' ? undefined : brand.get(brandName.toLocaleLowerCase('tr-TR'));
        if (c === undefined || u === undefined || (brandName !== '' && b === undefined))
          throw new Error('Kategori, marka veya birim yönetimdeki aktif kayıtlardan seçilmelidir.');
        const product = (await this.products.create(
          {
            name,
            shortDescription: shortDescription || undefined,
            description: description || undefined,
            brandId: b?.id,
            isPublished: ['evet', 'true', '1'].includes(isPublished.toLocaleLowerCase('tr-TR')),
            categories: [{ categoryId: c.id, isPrimary: true }],
            variants: [
              {
                sku,
                name: variantName || undefined,
                unitTypeId: u.id,
                unitQuantity,
                purchasePrice,
                salePrice,
                taxRate,
                stockQuantity,
                lowStockThreshold,
                isDefault: true,
                isActive: true,
              },
            ],
          },
          actor,
        )) as { id: string };
        for (const value of imageUrls
          .split(/[;,\n]/)
          .map((url) => url.trim())
          .filter(Boolean))
          await this.image(product.id, value, actor);
        created += 1;
      } catch (error) {
        failed.push({
          row: n,
          message: error instanceof Error ? error.message : 'Satır içe aktarılamadı.',
        });
      }
    return { created, failed };
  }
  private async image(productId: string, value: string, actor: ActorContext): Promise<void> {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
    )
      throw new Error('Görsel bağlantısı herkese açık HTTPS URL olmalıdır.');
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    const mimetype = response.headers.get('content-type')?.split(';')[0] ?? '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (
      !response.ok ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(mimetype) ||
      buffer.length > 5 * 1024 * 1024
    )
      throw new Error('Görsel JPG, PNG veya WebP ve en fazla 5 MB olmalıdır.');
    await this.uploads.uploadProductImages(
      productId,
      [
        {
          buffer,
          mimetype,
          originalname: url.pathname.split('/').pop() || 'gorsel',
          size: buffer.length,
        },
      ],
      actor,
    );
  }
}
