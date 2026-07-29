import { Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { OPEN_DEBT_SALE_STATUSES } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';

import type { OverdueQueryDto } from './dto/finance.dto';

/**
 * Vadesi geçmiş alacak listesi (Sprint 10 şartı 3).
 *
 * Dashboard ve yaşlandırma raporundan AYRI durur çünkü farklı bir soruyu
 * yanıtlar: "bugün kimi aramalıyım?". Bu yüzden satış bazındadır ve
 * gecikme gün sayısıyla birlikte döner.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async overdueSales(query: OverdueQueryDto, now: Date): Promise<OverdueReport> {
    // `dueDate < bugün VE remainingTotal > 0` (şart 3). Tamamı ödenmiş
    // satışın kalanı zaten sıfırdır; PAID durumu listeye giremez.
    const threshold = new Date(now.getTime() - (query.minDaysOverdue - 1) * 86_400_000);

    const sales = await this.prisma.sale.findMany({
      where: {
        status: { in: OPEN_DEBT_SALE_STATUSES as SaleStatus[] },
        remainingTotal: { gt: 0 },
        dueDate: { lt: threshold },
      },
      orderBy: query.sortBy === 'remainingTotal' ? { remainingTotal: 'desc' } : { dueDate: 'asc' },
      select: {
        id: true,
        saleNumber: true,
        status: true,
        saleDate: true,
        dueDate: true,
        grandTotal: true,
        paidTotal: true,
        remainingTotal: true,
        customer: {
          select: { id: true, code: true, fullName: true, phone: true, creditLimit: true },
        },
      },
    });

    const items = sales.map((sale) => ({
      ...sale,
      // Gecikme gün sayısı SUNUCUDA hesaplanır: istemcinin saati yanlışsa
      // ekrandaki "42 gün gecikmiş" rakamı da yanlış olurdu.
      daysOverdue: daysBetween(sale.dueDate as Date, now),
    }));

    return {
      items,
      totalOverdue: items
        .reduce((total, item) => total.plus(item.remainingTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(4)
        .toString(),
      saleCount: items.length,
      customerCount: new Set(items.map((item) => item.customer.id)).size,
    };
  }
}

export interface OverdueReport {
  items: unknown[];
  totalOverdue: string;
  saleCount: number;
  customerCount: number;
}

/** İki tarih arasındaki tam gün farkı. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
