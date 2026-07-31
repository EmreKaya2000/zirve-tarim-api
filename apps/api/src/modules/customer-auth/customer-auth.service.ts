import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, type CustomerAccount } from '@prisma/client';
import {
  CUSTOMER_PASSWORD_RULE_MESSAGE,
  ERROR_CODES,
  isValidCustomerPassword,
  type CustomerAccountProfile,
  type CustomerLoginResponse,
  type CustomerProfileUpdateResponse,
  type CustomerRegisterResponse,
  type CustomerVerifyEmailResponse,
} from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { generateRawToken, hashToken } from '../../common/utils/token-hash';
import { AppConfig } from '../../config/app.config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PasswordService } from '../auth/password.service';
import { normalizeEmail } from '../auth/auth.service';
import { normalizePhone } from '../../common/utils/phone';
import { MailService } from '../mail/mail.service';
import {
  buildPasswordChangedMail,
  buildPasswordResetMail,
  buildVerificationMail,
} from '../mail/mail.templates';

import {
  CUSTOMER_REVOKE_REASONS,
  CustomerTokenService,
  type CustomerTokenContext,
} from './customer-token.service';
import {
  CUSTOMER_ACCOUNT_PUBLIC_SELECT,
  toCustomerAccountProfile,
} from './customer-account.select';
import type {
  CustomerLoginDto,
  CustomerRegisterDto,
  UpdateCustomerProfileDto,
} from './dto/customer-auth.dto';

/** Hesabın kilitleneceği ardışık başarısız deneme sayısı — `users` ile aynı. */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Kilit süresi (dakika). */
const LOCKOUT_MINUTES = 15;

/**
 * E-posta doğrulama bağlantısının ömrü (saat).
 *
 * 24 saat: kullanıcı akşam kayıt olup sabah posta kutusunu açabilir. Daha
 * kısası, gerçek kullanıcıları "bağlantı süresi dolmuş" duvarına çarptırır.
 */
const EMAIL_VERIFICATION_TTL_HOURS = 24;

/**
 * Şifre sıfırlama bağlantısının ömrü (dakika).
 *
 * 30 dakika: bu bağlantı hesabı DEVRALMA yetkisi taşır. Posta kutusuna
 * sonradan erişen biri (ortak bilgisayar, çalınmış telefon) eski bir
 * sıfırlama e-postasını kullanamamalıdır. Doğrulama jetonundan çok daha
 * kısa olması bu yüzdendir.
 */
const PASSWORD_RESET_TTL_MINUTES = 30;

const ENTITY_TYPE = 'CustomerAccount';

/**
 * TÜM kayıt ve şifre sıfırlama isteklerine verilen TEK yanıt metni.
 *
 * "E-posta gönderildi" DEMEZ: e-posta kayıtlı değilse gerçekten
 * gönderilmemiştir ve yanlış bilgi vermek istemeyiz. "Kayıtlıysa gönderildi"
 * biçimi hem doğru hem de adresin varlığı hakkında hiçbir şey söylemez.
 */
const GENERIC_EMAIL_SENT_MESSAGE =
  'İşleminiz alındı. Bu adres sistemde kayıtlıysa e-posta kutunuza bir bağlantı gönderildi. ' +
  'Gelen kutunuzu (ve gereksiz/spam klasörünü) kontrol edin.';

/**
 * Müşteri (public) kimlik doğrulama iş mantığı — Sprint 11.
 *
 * GÜVENLİK İLKELERİ (yönetici tarafıyla aynı ama bir eklemeyle):
 *  - Yanlış e-posta ile yanlış şifre AYNI hatayı verir.
 *  - Pasif hesap giriş yapamaz.
 *  - Refresh token tek kullanımlıktır (rotation); yeniden kullanım tüm
 *    oturumları düşürür.
 *  - EK OLARAK: kayıt ve şifre sıfırlama uçları bir adresin sistemde kayıtlı
 *    olup olmadığını SÖYLEMEZ. Yönetici girişinde bu sorun yoktu (hesapları
 *    yönetici açar, kimse kendi kendine kayıt olmaz); vitrinde ise kayıt ucu
 *    herkese açıktır ve tüm müşteri listesini sızdırabilecek tek yerdir.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokens: CustomerTokenService,
    private readonly auditLogs: AuditLogsService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  // ==========================================================================
  // KAYIT
  // ==========================================================================

  /**
   * Yeni müşteri hesabı oluşturur.
   *
   * Yanıt HER DURUMDA aynıdır — jeton dönmez (gerekçe:
   * `CustomerRegisterResponse` tipinin açıklaması). İstemci ardından giriş
   * ucunu çağırır.
   */
  async register(
    dto: CustomerRegisterDto,
    context: CustomerTokenContext,
  ): Promise<CustomerRegisterResponse> {
    if (dto.consentAccepted !== true) {
      throw new AppException(
        ERROR_CODES.CONSENT_REQUIRED,
        'Hesap oluşturmak için KVKK onayı gereklidir.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'consentAccepted', message: 'Aydınlatma metnini onaylamanız gerekir.' }],
      );
    }

    this.assertPasswordPolicy(dto.password);

    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);

    // Silinmiş hesaplar DAHİL aranır: `email` kolonu UNIQUE olduğu için soft
    // delete edilmiş bir satır adresi hâlâ tutar. Bulunursa yeni kayıt
    // denemesi sessizce "zaten var" yoluna girer ve kullanıcı hesabını geri
    // almak için destekle iletişime geçer — sessiz bir UNIQUE hatası yerine.
    // findFirst: `email` artik PARTIAL unique (WHERE deletedAt IS NULL), yani
    // Prisma tarafinda tekil bir anahtar degil. deletedAt FILTRESI BILEREK
    // YOK: silinmis hesabin e-postasi DB'de serbest olsa da kayit akisi onu
    // "zaten var" sayip kullaniciyi destege yonlendirir (yukaridaki gerekce).
    const existing = await this.prisma.customerAccount.findFirst({
      where: { email },
      select: { id: true, firstName: true, email: true, deletedAt: true },
    });

    if (existing !== null) {
      // ADRES SAHİBİNE HABER VERİLİR, İSTEK SAHİBİNE VERİLMEZ.
      //
      // Yanıt yeni kayıtla aynı olduğu için istekte bulunan kişi hiçbir şey
      // öğrenmez. Adresin gerçek sahibi ise birinin adresiyle kayıt olmaya
      // çalıştığını öğrenir ve gerekiyorsa şifresini sıfırlar.
      if (existing.deletedAt === null) {
        await this.sendPasswordResetFor(
          { id: existing.id, email: existing.email, firstName: existing.firstName },
          context,
        );
      }

      this.logger.log(`Kayıtlı adresle yeniden kayıt denemesi (hesap: ${existing.id}).`);

      return { success: true, message: GENERIC_EMAIL_SENT_MESSAGE };
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const rawToken = generateRawToken();
    const now = new Date();

    let accountId: string;
    let firstName: string;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const account = await tx.customerAccount.create({
          data: {
            email,
            phone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            consentAt: now,
            consentIpAddress: context.ipAddress ?? null,
            verificationTokens: {
              create: {
                email,
                tokenHash: hashToken(rawToken),
                expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
              },
            },
          },
          select: { id: true, firstName: true },
        });

        await this.auditLogs.record(tx, {
          // userId FK'sı `users` tablosuna bakar; müşteri hesabı oraya
          // yazılamaz. Hesap kimliği `entityId` alanında taşınır.
          userId: null,
          action: AuditAction.CREATE,
          entityType: ENTITY_TYPE,
          entityId: account.id,
          newData: { email, phone },
          description: `Müşteri hesabı oluşturuldu: ${email}`,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return account;
      });

      accountId = created.id;
      firstName = created.firstName;
    } catch (error) {
      // Eşzamanlı iki kayıt isteği: ikinci istek UNIQUE kısıtına takılır.
      // Bu da "adres kayıtlı" durumudur ve AYNI genel yanıtı almalıdır;
      // 409 dönmek adresin varlığını ele verirdi.
      if (isUniqueViolation(error)) {
        return { success: true, message: GENERIC_EMAIL_SENT_MESSAGE };
      }

      throw error;
    }

    // E-POSTA TRANSACTION DIŞINDA GÖNDERİLİR.
    //
    // İçinde gönderilseydi SMTP el sıkışması boyunca (saniyeler) transaction
    // açık kalır ve gönderim hatası hesabı geri alırdı: kullanıcı "kayıt
    // olamadım" görür, oysa tek sorun posta sunucusudur. Hesap oluştu, jeton
    // duruyor; e-posta yeniden gönderilebilir.
    await this.mail.send(
      buildVerificationMail({
        to: email,
        firstName,
        verifyUrl: this.buildWebUrl('/eposta-dogrula', rawToken),
        expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      }),
    );

    this.logger.log(`Müşteri hesabı oluşturuldu: ${accountId}`);

    return { success: true, message: GENERIC_EMAIL_SENT_MESSAGE };
  }

  // ==========================================================================
  // GİRİŞ / OTURUM
  // ==========================================================================

  async login(
    dto: CustomerLoginDto,
    context: CustomerTokenContext,
  ): Promise<CustomerLoginResponse> {
    const email = normalizeEmail(dto.email);

    const account = await this.prisma.customerAccount.findFirst({
      where: { email, deletedAt: null },
    });

    // Hesap yoksa bile şifre doğrulamasının maliyeti ödenir: aksi hâlde yanıt
    // süresi farkından adresin kayıtlı olup olmadığı anlaşılır.
    if (account === null) {
      await this.passwordService.verify(DUMMY_HASH, dto.password);
      await this.recordFailedLogin(null, email, context, 'Hesap bulunamadı');

      throw AppException.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
    }

    this.assertNotLocked(account);

    const passwordValid = await this.passwordService.verify(account.passwordHash, dto.password);

    if (!passwordValid) {
      await this.registerFailedAttempt(account);
      await this.recordFailedLogin(account.id, email, context, 'Şifre hatalı');

      throw AppException.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
    }

    // Şifre doğru ama hesap pasif: kimliğini kanıtladı, neden giremediğini
    // bilmeli (yönetici girişindeki aynı gerekçe).
    if (!account.isActive) {
      await this.recordFailedLogin(account.id, email, context, 'Hesap pasif');

      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return this.prisma.$transaction(async (tx) => {
      const issued = await this.tokens.issueTokens(
        tx,
        { id: account.id, email: account.email },
        context,
      );

      const updated = await tx.customerAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        select: CUSTOMER_ACCOUNT_PUBLIC_SELECT,
      });

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.LOGIN,
        entityType: ENTITY_TYPE,
        entityId: account.id,
        description: `Müşteri girişi: ${email}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return {
        ...issued,
        tokenType: 'Bearer' as const,
        account: toCustomerAccountProfile(updated),
      };
    });
  }

  /** Refresh token'ı yenisiyle değiştirir (rotation). */
  async refresh(
    rawRefreshToken: string,
    context: CustomerTokenContext,
  ): Promise<CustomerLoginResponse> {
    const tokenHash = this.tokens.hashRefreshToken(rawRefreshToken);

    const stored = await this.prisma.customerRefreshToken.findUnique({
      where: { tokenHash },
      include: {
        // Public alanların YANINA `isActive` ve `deletedAt` eklenir: jeton
        // geçerli olsa bile hesap kapatılmış olabilir ve bu tek sorguda
        // görülmelidir.
        customerAccount: {
          select: { ...CUSTOMER_ACCOUNT_PUBLIC_SELECT, isActive: true, deletedAt: true },
        },
      },
    });

    if (stored === null) {
      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    // İptal edilmiş jetonun yeniden kullanımı: jeton sızmış olabilir. Hangi
    // tarafın saldırgan olduğu bilinemediği için tüm oturumlar düşürülür.
    if (stored.revokedAt !== null) {
      await this.handleTokenReuse(stored.customerAccountId, context);

      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    const account = stored.customerAccount;

    if (account.deletedAt !== null || !account.isActive) {
      await this.prisma.$transaction(async (tx) => {
        await this.tokens.revokeAllForAccount(
          tx,
          account.id,
          CUSTOMER_REVOKE_REASONS.ACCOUNT_DEACTIVATED,
        );
      });

      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return this.prisma.$transaction(async (tx) => {
      // Önce iptal, sonra yeni jeton: aynı transaction içinde olduğu için
      // araya başka bir istek giremez.
      await this.tokens.revoke(tx, tokenHash, CUSTOMER_REVOKE_REASONS.ROTATED);

      const issued = await this.tokens.issueTokens(
        tx,
        { id: account.id, email: account.email },
        context,
        tokenHash,
      );

      return {
        ...issued,
        tokenType: 'Bearer' as const,
        account: toCustomerAccountProfile(account),
      };
    });
  }

  /** Çıkış: verilen refresh token iptal edilir. */
  async logout(
    accountId: string,
    rawRefreshToken: string | undefined,
    context: CustomerTokenContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (rawRefreshToken !== undefined && rawRefreshToken.length > 0) {
        // `where` yalnız hash ile değil HESAP KİMLİĞİYLE de daraltılır:
        // istemci başkasının jetonunu gönderirse onu iptal edememelidir.
        await tx.customerRefreshToken.updateMany({
          where: {
            tokenHash: this.tokens.hashRefreshToken(rawRefreshToken),
            customerAccountId: accountId,
            revokedAt: null,
          },
          data: { revokedAt: new Date(), revokedReason: CUSTOMER_REVOKE_REASONS.LOGOUT },
        });
      }

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.LOGOUT,
        entityType: ENTITY_TYPE,
        entityId: accountId,
        description: 'Müşteri çıkışı.',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });
  }

  /** Oturum açmış müşterinin profili. */
  async getProfile(accountId: string): Promise<CustomerAccountProfile> {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: CUSTOMER_ACCOUNT_PUBLIC_SELECT,
    });

    if (account === null) {
      throw AppException.unauthorized();
    }

    return toCustomerAccountProfile(account);
  }

  // ==========================================================================
  // E-POSTA DOĞRULAMA
  // ==========================================================================

  /**
   * E-posta doğrulama jetonunu kullanır.
   *
   * ÜÇ İŞİ TEK TRANSACTION İÇİNDE yapar:
   *   1. Jetonu kullanılmış işaretler (tek kullanımlık)
   *   2. Hesabı doğrulanmış işaretler; adres değişikliğiyse adresi günceller
   *   3. AYNI e-postayla gönderilmiş MİSAFİR taleplerini hesaba bağlar
   *
   * Üçü ayrı ayrı yazılsaydı, 2 olup 3 olmayan bir hâl mümkün olurdu:
   * kullanıcı "doğrulandı" görür ama geçmiş talepleri hiç görünmez ve
   * jeton da kullanılmış olduğu için tekrar denemesinin faydası olmaz.
   */
  async verifyEmail(
    rawToken: string,
    context: CustomerTokenContext,
  ): Promise<CustomerVerifyEmailResponse> {
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        customerAccountId: true,
        customerAccount: { select: { id: true, email: true, deletedAt: true, isActive: true } },
      },
    });

    // Geçersiz / süresi dolmuş / kullanılmış: ÜÇÜ DE aynı hatayı verir.
    // Ayırt etmek, geçerli jeton adresi arayan birine geri bildirim olurdu.
    if (
      stored === null ||
      stored.usedAt !== null ||
      stored.expiresAt.getTime() <= Date.now() ||
      stored.customerAccount.deletedAt !== null
    ) {
      throw new AppException(
        ERROR_CODES.INVALID_TOKEN,
        'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı isteyin.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isEmailChange = stored.email !== stored.customerAccount.email;

    // ADRES DEĞİŞİKLİĞİNDE TEKİLLİK YENİDEN KONTROL EDİLİR: jeton üretildiği
    // an adres boştu ama bağlantı açılana kadar başkası o adresle kayıt olmuş
    // olabilir. Kontrol edilmezse transaction UNIQUE hatasıyla 500'e düşerdi.
    if (isEmailChange) {
      const taken = await this.prisma.customerAccount.findFirst({
        where: { email: stored.email },
        select: { id: true },
      });

      if (taken !== null && taken.id !== stored.customerAccountId) {
        throw AppException.conflict(
          'Bu e-posta adresi artık kullanılamıyor. Lütfen başka bir adres deneyin.',
          [{ field: 'email', message: 'Adres bu sırada başka bir hesaba tanımlanmış.' }],
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Tek kullanımlık güvencesi: `usedAt: null` koşulu updateMany'nin
      // WHERE'ine yazılır. Eşzamanlı iki istekte yalnız biri satırı günceller;
      // ikincisinin sayacı 0 döner ve akış reddedilir.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new AppException(
          ERROR_CODES.INVALID_TOKEN,
          'Doğrulama bağlantısı zaten kullanılmış.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const account = await tx.customerAccount.update({
        where: { id: stored.customerAccountId },
        data: {
          emailVerifiedAt: new Date(),
          ...(isEmailChange && { email: stored.email }),
        },
        select: CUSTOMER_ACCOUNT_PUBLIC_SELECT,
      });

      const linkedInquiryCount = await linkGuestInquiries(tx, account.id, account.email);

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.EMAIL_VERIFIED,
        entityType: ENTITY_TYPE,
        entityId: account.id,
        newData: { email: account.email, linkedInquiryCount },
        description: isEmailChange
          ? `Müşteri e-posta adresi değiştirildi ve doğrulandı: ${account.email}`
          : `Müşteri e-postası doğrulandı: ${account.email}` +
            (linkedInquiryCount > 0 ? ` (${linkedInquiryCount} geçmiş talep bağlandı)` : ''),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return { account, linkedInquiryCount };
    });

    return {
      account: toCustomerAccountProfile(result.account),
      linkedInquiryCount: result.linkedInquiryCount,
    };
  }

  // ==========================================================================
  // ŞİFRE SIFIRLAMA
  // ==========================================================================

  /**
   * Şifre sıfırlama bağlantısı ister.
   *
   * Adres kayıtlı olmasa da AYNI yanıt döner ve aynı süre harcanır. Yanıt
   * biçiminden veya süresinden hesabın varlığı çıkarılamaz.
   */
  async forgotPassword(
    rawEmail: string,
    context: CustomerTokenContext,
  ): Promise<{ success: true; message: string }> {
    const email = normalizeEmail(rawEmail);

    const account = await this.prisma.customerAccount.findFirst({
      where: { email, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true },
    });

    if (account !== null) {
      await this.sendPasswordResetFor(account, context);
    } else {
      this.logger.log('Bilinmeyen adres için şifre sıfırlama isteği (genel yanıt döndü).');
    }

    return { success: true, message: GENERIC_EMAIL_SENT_MESSAGE };
  }

  /**
   * Şifreyi sıfırlar.
   *
   * TÜM OTURUMLAR DÜŞÜRÜLÜR. Şifre sıfırlamanın en yaygın nedeni hesabın ele
   * geçirilmiş olmasıdır; saldırganın elindeki yenileme jetonu geçerli
   * kalırsa şifre değiştirmenin bir anlamı olmaz.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
    context: CustomerTokenContext,
  ): Promise<{ success: true; message: string }> {
    this.assertPasswordPolicy(newPassword);

    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        expiresAt: true,
        usedAt: true,
        customerAccountId: true,
        customerAccount: {
          select: {
            id: true,
            email: true,
            firstName: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      stored === null ||
      stored.usedAt !== null ||
      stored.expiresAt.getTime() <= Date.now() ||
      stored.customerAccount.deletedAt !== null ||
      !stored.customerAccount.isActive
    ) {
      throw new AppException(
        ERROR_CODES.INVALID_TOKEN,
        'Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı isteyin.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    const account = stored.customerAccount;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new AppException(
          ERROR_CODES.INVALID_TOKEN,
          'Sıfırlama bağlantısı zaten kullanılmış.',
          HttpStatus.BAD_REQUEST,
        );
      }

      await tx.customerAccount.update({
        where: { id: account.id },
        // Kilit de sıfırlanır: şifresini unutup 5 kez deneyen kullanıcı,
        // sıfırlamayı tamamladıktan sonra 15 dakika beklemek zorunda kalmaz.
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });

      // Bekleyen DİĞER sıfırlama jetonları da geçersizleşir: aksi hâlde
      // saldırganın daha önce istediği bir bağlantı hâlâ çalışırdı.
      await tx.passwordResetToken.updateMany({
        where: { customerAccountId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await this.tokens.revokeAllForAccount(
        tx,
        account.id,
        CUSTOMER_REVOKE_REASONS.PASSWORD_CHANGED,
      );

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.PASSWORD_CHANGE,
        entityType: ENTITY_TYPE,
        entityId: account.id,
        description: `Müşteri şifresi sıfırlandı: ${account.email}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });

    await this.mail.send(
      buildPasswordChangedMail({
        to: account.email,
        firstName: account.firstName,
        supportUrl: `${this.config.publicWebUrl}/iletisim`,
      }),
    );

    return {
      success: true,
      message: 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.',
    };
  }

  // ==========================================================================
  // PROFİL
  // ==========================================================================

  /**
   * Profili günceller.
   *
   * E-POSTA ANINDA DEĞİŞMEZ: yeni adrese doğrulama bağlantısı gönderilir ve
   * adres ancak bağlantı açıldığında güncellenir (Sprint 11 şartı 4). Aksi
   * hâlde yanlış yazılmış bir adres hesabı kalıcı olarak erişilemez yapardı —
   * giriş anahtarı e-postadır ve sıfırlama bağlantısı da oraya gider.
   */
  async updateProfile(
    accountId: string,
    dto: UpdateCustomerProfileDto,
    context: CustomerTokenContext,
  ): Promise<CustomerProfileUpdateResponse> {
    const existing = await this.prisma.customerAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true },
    });

    if (existing === null) {
      throw AppException.unauthorized();
    }

    const nextEmail = dto.email === undefined ? undefined : normalizeEmail(dto.email);
    const isEmailChange = nextEmail !== undefined && nextEmail !== existing.email;

    const data: Prisma.CustomerAccountUpdateInput = {
      ...(dto.firstName !== undefined && { firstName: dto.firstName }),
      ...(dto.lastName !== undefined && { lastName: dto.lastName }),
      ...(dto.phone !== undefined && { phone: normalizePhone(dto.phone) }),
    };

    // Adres BAŞKA BİR HESAPTA kullanılıyorsa doğrulama e-postası hiç
    // gönderilmez. Burada 409 dönmek adresin kayıtlı olduğunu ele verir ama
    // ödünleşme bilinçlidir: kullanıcı KENDİ oturumundadır ve "bu adres
    // kullanılamıyor" bilgisi olmadan neden değişmediğini asla anlamaz.
    // Kayıt ucundaki enumeration riski burada yoktur — girişli bir hesap
    // başına saatte birkaç deneme ile liste taranamaz (rate limit).
    if (isEmailChange) {
      const taken = await this.prisma.customerAccount.findFirst({
        where: { email: nextEmail },
        select: { id: true },
      });

      if (taken !== null) {
        throw AppException.conflict('Bu e-posta adresi kullanılamıyor.', [
          { field: 'email', message: 'Bu adres başka bir hesapta tanımlı.' },
        ]);
      }
    }

    const rawToken = isEmailChange ? generateRawToken() : null;

    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerAccount.update({
        where: { id: accountId },
        data,
        select: CUSTOMER_ACCOUNT_PUBLIC_SELECT,
      });

      if (rawToken !== null && nextEmail !== undefined) {
        // Bekleyen eski adres değişikliği jetonları geçersizleşir: kullanıcı
        // adresi iki kez değiştirdiyse yalnız SON istediği geçerli olmalıdır.
        await tx.emailVerificationToken.updateMany({
          where: { customerAccountId: accountId, usedAt: null },
          data: { usedAt: new Date() },
        });

        await tx.emailVerificationToken.create({
          data: {
            customerAccountId: accountId,
            email: nextEmail,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
          },
        });
      }

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: accountId,
        oldData: {
          firstName: existing.firstName,
          lastName: existing.lastName,
          phone: existing.phone,
        },
        newData: {
          firstName: updated.firstName,
          lastName: updated.lastName,
          phone: updated.phone,
          ...(isEmailChange && { pendingEmail: nextEmail }),
        },
        description: 'Müşteri profili güncellendi.',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    });

    if (rawToken !== null && nextEmail !== undefined) {
      await this.mail.send(
        buildVerificationMail({
          to: nextEmail,
          firstName: account.firstName,
          verifyUrl: this.buildWebUrl('/eposta-dogrula', rawToken),
          expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
        }),
      );
    }

    return {
      account: toCustomerAccountProfile(account),
      pendingEmail: isEmailChange && nextEmail !== undefined ? nextEmail : null,
    };
  }

  /**
   * Doğrulama e-postasını yeniden gönderir.
   *
   * Zaten doğrulanmış hesap için sessizce başarılı döner: "hesabınız zaten
   * doğrulanmış" demek yanlış bir şey söylemez ama arayüzde ele alınması
   * gereken ikinci bir durum üretir; kullanıcının göreceği sonuç aynıdır.
   */
  async resendVerification(
    accountId: string,
    context: CustomerTokenContext,
  ): Promise<{ success: true; message: string }> {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
    });

    if (account === null) {
      throw AppException.unauthorized();
    }

    if (account.emailVerifiedAt !== null) {
      return { success: true, message: 'E-posta adresiniz zaten doğrulanmış.' };
    }

    const rawToken = generateRawToken();

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { customerAccountId: accountId, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.emailVerificationToken.create({
        data: {
          customerAccountId: accountId,
          email: account.email,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
        },
      });

      // Yeniden gönderim de kaydedilir: bir hesap için art arda onlarca
      // doğrulama e-postası üretilmesi, hız sınırının aşılmaya çalışıldığını
      // veya bir istemci döngüsünü gösterir ve iz bırakmalıdır.
      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: accountId,
        description: `Doğrulama e-postası yeniden gönderildi: ${account.email}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });

    await this.mail.send(
      buildVerificationMail({
        to: account.email,
        firstName: account.firstName,
        verifyUrl: this.buildWebUrl('/eposta-dogrula', rawToken),
        expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      }),
    );

    return { success: true, message: GENERIC_EMAIL_SENT_MESSAGE };
  }

  // ==========================================================================
  // YARDIMCILAR
  // ==========================================================================

  /** Şifre politikasını uygular. Kural `@zirve/types` içinde TEK yerde. */
  private assertPasswordPolicy(password: string): void {
    if (isValidCustomerPassword(password)) {
      return;
    }

    throw new AppException(
      ERROR_CODES.WEAK_PASSWORD,
      CUSTOMER_PASSWORD_RULE_MESSAGE,
      HttpStatus.BAD_REQUEST,
      [{ field: 'password', message: CUSTOMER_PASSWORD_RULE_MESSAGE }],
    );
  }

  /**
   * Şifre sıfırlama jetonu üretir ve e-postayı gönderir.
   *
   * İki yerden çağrılır: `forgotPassword` ve `register` (adres zaten
   * kayıtlıysa). İkinci kullanım, adresin sahibine "biri adresinizle kayıt
   * olmaya çalıştı, hesabınız zaten var" mesajını iletmenin yoludur.
   */
  private async sendPasswordResetFor(
    account: { id: string; email: string; firstName: string },
    context: CustomerTokenContext,
  ): Promise<void> {
    const rawToken = generateRawToken();

    await this.prisma.$transaction(async (tx) => {
      // Aynı hesap için bekleyen eski jetonlar geçersizleşir: aynı anda beş
      // geçerli sıfırlama bağlantısının dolaşması saldırı yüzeyini büyütür.
      await tx.passwordResetToken.updateMany({
        where: { customerAccountId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: {
          customerAccountId: account.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
          requestIpAddress: context.ipAddress ?? null,
        },
      });
    });

    await this.mail.send(
      buildPasswordResetMail({
        to: account.email,
        firstName: account.firstName,
        resetUrl: this.buildWebUrl('/sifre-sifirla', rawToken),
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      }),
    );
  }

  /**
   * E-postaya konacak vitrin adresini kurar.
   *
   * Kök adres YAPILANDIRMADAN gelir, isteğin `Host` başlığından DEĞİL:
   * saldırgan o başlığı değiştirerek sıfırlama bağlantısını kendi alan adına
   * yönlendirebilirdi (host header injection) ve kullanıcı jetonu ona
   * teslim ederdi.
   */
  private buildWebUrl(path: string, token: string): string {
    return `${this.config.publicWebUrl}${path}/${encodeURIComponent(token)}`;
  }

  private assertNotLocked(account: CustomerAccount): void {
    if (account.lockedUntil !== null && account.lockedUntil.getTime() > Date.now()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000);

      throw AppException.unauthorized(
        ERROR_CODES.ACCOUNT_LOCKED,
        `Çok fazla hatalı deneme. Hesabınız ${remainingMinutes} dakika sonra tekrar denenebilir.`,
      );
    }
  }

  /** Başarısız denemeyi sayar; eşiği aşınca hesabı geçici kilitler. */
  private async registerFailedAttempt(account: CustomerAccount): Promise<void> {
    const nextCount = account.failedLoginCount + 1;
    const shouldLock = nextCount >= MAX_FAILED_LOGIN_ATTEMPTS;

    await this.prisma.customerAccount.update({
      where: { id: account.id },
      data: {
        failedLoginCount: shouldLock ? 0 : nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Müşteri hesabı geçici olarak kilitlendi: ${account.id}`);
    }
  }

  private async handleTokenReuse(accountId: string, context: CustomerTokenContext): Promise<void> {
    this.logger.warn(
      `Müşteri yenileme jetonu yeniden kullanıldı (hesap=${accountId}). Tüm oturumlar iptal ediliyor.`,
    );

    await this.prisma.$transaction(async (tx) => {
      const revokedCount = await this.tokens.revokeAllForAccount(
        tx,
        accountId,
        CUSTOMER_REVOKE_REASONS.REUSE_DETECTED,
      );

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.LOGIN_FAILED,
        entityType: ENTITY_TYPE,
        entityId: accountId,
        description: `İptal edilmiş yenileme jetonu yeniden kullanıldı. ${revokedCount} oturum iptal edildi.`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });
  }

  /**
   * Başarısız giriş denemesini kaydeder.
   *
   * `recordSafe`: denetim kaydı yazılamazsa bile giriş akışı normal şekilde
   * (reddederek) sonuçlanmalıdır.
   */
  private async recordFailedLogin(
    accountId: string | null,
    email: string,
    context: CustomerTokenContext,
    reason: string,
  ): Promise<void> {
    await this.auditLogs.recordSafe({
      userId: null,
      action: AuditAction.LOGIN_FAILED,
      entityType: ENTITY_TYPE,
      entityId: accountId,
      description: `Başarısız müşteri girişi (${email}): ${reason}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }
}

/**
 * Geçmiş MİSAFİR taleplerini hesaba bağlar — Sprint 11 şartı 3.
 *
 * YALNIZ E-POSTA EŞLEŞMESİYLE ve YALNIZ DOĞRULAMADAN SONRA çağrılır.
 *
 * TELEFON EŞLEŞMESİYLE OTOMATİK BAĞLAMA YAPILMAZ. Gerekçe: telefon numarası
 * bu sistemde DOĞRULANMIYOR (SMS akışı yok). "0532..." yazan herkes o
 * numaranın sahibi sayılırsa, mağazanın müşterisinin numarasını bilen biri
 * (fatura, tabela, ortak tanıdık) kayıt olup o kişinin talep geçmişini —
 * ne aldığı, ne kadarlık iş yaptığı — okuyabilirdi. Numara eşleşmesi
 * yöneticiye ipucu olarak GÖSTERİLİR ve bağlama elle yapılır (şart 5).
 *
 * Yalnız `customerAccountId IS NULL` olan talepler taşınır: bir talep başka
 * bir hesaba bağlıysa dokunulmaz.
 */
export async function linkGuestInquiries(
  tx: Prisma.TransactionClient,
  customerAccountId: string,
  verifiedEmail: string,
): Promise<number> {
  const result = await tx.inquiry.updateMany({
    where: {
      customerAccountId: null,
      // TAM EŞİTLİK (mode: 'insensitive' DEĞİL): `contactEmail` küçük harfe
      // normalleştirilmiş saklanır ve `inquiries_contactEmail_idx` indeksi
      // ancak tam eşitlikle kullanılır.
      contactEmail: verifiedEmail,
      deletedAt: null,
    },
    data: { customerAccountId },
  });

  return result.count;
}

/**
 * Hesap bulunamadığında zaman farkını gizlemek için doğrulanan sahte hash.
 * Gerçek bir Argon2id çıktısıdır; hiçbir şifreyle eşleşmez.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$1kzP1CZzTlKPBQ8Yl8v3Kb0kQ4oqvPKfAhOwZ8kM8Xo';

/** Prisma'nın UNIQUE ihlali hatası mı? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
