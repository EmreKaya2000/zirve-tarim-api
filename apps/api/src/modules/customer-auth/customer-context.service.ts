import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TOKEN_AUDIENCES, TOKEN_ISSUER, type CustomerJwtPayload } from '@zirve/types';
import type { Request } from 'express';

import { AppConfig } from '../../config/app.config';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** İsteğe bağlı olarak çözülmüş müşteri bağlamı. */
export interface OptionalCustomerContext {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isEmailVerified: boolean;
}

/**
 * PUBLIC bir uçta müşteriyi İSTEĞE BAĞLI olarak tanır.
 *
 * NEDEN GUARD DEĞİL: `POST /public/inquiries` misafire de açıktır ve açık
 * KALMALIDIR (Sprint 6 akışı bozulmaz — Sprint 11 kapsamının açık şartı).
 * Bir guard "geçerli kimlik yoksa reddet" demektir; burada istenen "kimlik
 * varsa tanı, yoksa devam et"tir.
 *
 * GEÇERSİZ JETON İSTEĞİ DÜŞÜRMEZ, YOK SAYILIR. Süresi dolmuş bir jetonla
 * gelen ziyaretçi, talebini misafir olarak gönderebilmelidir; oturumun
 * sessizce ölmüş olması yüzünden formu kaybetmesi kabul edilemez. Talep yine
 * de kaydedilir, yalnız hesabına bağlanmaz.
 */
@Injectable()
export class CustomerContextService {
  private readonly logger = new Logger(CustomerContextService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * İstekteki müşteri jetonunu çözer.
   *
   * @returns Geçerli bir müşteri oturumu varsa hesap bilgisi; yoksa `null`.
   */
  async resolveOptional(request: Request): Promise<OptionalCustomerContext | null> {
    const token = extractBearerToken(request.get('authorization'));

    if (token === null) {
      return null;
    }

    let payload: CustomerJwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<CustomerJwtPayload>(token, {
        secret: this.config.jwtCustomerAccessSecret,
        audience: TOKEN_AUDIENCES.CUSTOMER,
        issuer: TOKEN_ISSUER,
      });
    } catch {
      // Yönetici jetonu da buraya düşer (farklı sır ve audience) ve doğru
      // davranış onu YOK SAYMAKTIR: yönetici vitrinden talep gönderiyorsa
      // bu bir müşteri talebi değildir, kendi hesabına bağlanmamalıdır.
      return null;
    }

    const account = await this.prisma.customerAccount.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        emailVerifiedAt: true,
      },
    });

    if (account === null) {
      this.logger.warn('Geçerli jeton ama hesap bulunamadı/pasif; misafir olarak devam ediliyor.');

      return null;
    }

    return {
      id: account.id,
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      phone: account.phone,
      isEmailVerified: account.emailVerifiedAt !== null,
    };
  }
}

/** `Authorization: Bearer <token>` başlığından jetonu ayıklar. */
function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return null;
  }

  return token;
}
