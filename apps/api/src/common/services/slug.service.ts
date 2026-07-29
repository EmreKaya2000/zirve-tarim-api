import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { appendSlugSuffix, slugify, SLUG_MAX_LENGTH } from '../utils/slug.util';

/**
 * Prisma'nın slug taşıyan modelleri.
 * Yeni bir taksonomi tablosu eklendiğinde buraya da eklenir.
 */
export type SluggableModel =
  | 'category'
  | 'brand'
  | 'plant'
  | 'soilType'
  | 'benefit'
  | 'sideEffect'
  | 'usagePeriod'
  | 'unitType'
  | 'product';

/** Sonek denemesi için üst sınır. Aşılırsa zaman damgası eklenir. */
const MAX_SUFFIX_ATTEMPTS = 100;

/**
 * Benzersiz slug üretimi.
 *
 * Slug addan türetilir; çakışma varsa sonek eklenir (`sivi-gubre-2`).
 * Veritabanındaki UNIQUE kısıt son savunma hattıdır — burada üretilen
 * değer yine de çakışırsa Prisma P2002 fırlatır ve global filtre 409'a çevirir.
 */
@Injectable()
export class SlugService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verilen ad için benzersiz slug üretir.
   *
   * @param model      Kontrol edilecek tablo
   * @param name       Slug'ın türetileceği ad
   * @param excludeId  Güncellemede kendi kaydını çakışma saymamak için
   * @param tx         Transaction içinde çalışılıyorsa istemci
   */
  async generate(
    model: SluggableModel,
    name: string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const base = slugify(name);

    if (base.length === 0) {
      // Ad tamamen özel karakterden oluşuyorsa (ör. "!!!") slug üretilemez.
      // Bu durumda zaman damgalı bir yedek kullanılır; DTO doğrulaması
      // normalde böyle bir adı zaten reddeder.
      return `kayit-${Date.now()}`;
    }

    if (!(await this.exists(model, base, excludeId, tx))) {
      return base;
    }

    for (let suffix = 2; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
      const candidate = appendSlugSuffix(base, suffix, SLUG_MAX_LENGTH);

      if (!(await this.exists(model, candidate, excludeId, tx))) {
        return candidate;
      }
    }

    // 100 denemede boş yer bulunamadıysa zaman damgası kesin çözümdür.
    return appendSlugSuffix(base, Date.now(), SLUG_MAX_LENGTH);
  }

  /**
   * Slug'ın kullanımda olup olmadığını kontrol eder.
   *
   * SOFT DELETE EDİLMİŞ kayıtlar da kontrole DAHİLDİR: slug sütununda
   * koşulsuz bir UNIQUE kısıt vardır, silinmiş kaydın slug'ı hâlâ yer kaplar.
   * (Kısmi index kullanılmama gerekçesi için auth migration'ındaki nota bakınız.)
   */
  private async exists(
    model: SluggableModel,
    slug: string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;

    const where: { slug: string; id?: { not: string } } = { slug };

    if (excludeId !== undefined) {
      where.id = { not: excludeId };
    }

    // Prisma delegate'leri aynı `findFirst` imzasını paylaşır ama tipleri
    // birleşim (union) olduğu için doğrudan daraltılamaz; `unknown` üzerinden
    // geçilir. Model adı `SluggableModel` ile sınırlı olduğundan bu güvenlidir.
    const delegate = client[model] as unknown as {
      findFirst: (args: { where: unknown; select: { id: true } }) => Promise<{ id: string } | null>;
    };

    const found = await delegate.findFirst({ where, select: { id: true } });

    return found !== null;
  }
}
