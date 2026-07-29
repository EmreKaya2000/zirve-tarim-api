import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfig } from '../../config/app.config';

/** Gönderilecek tek bir e-posta. */
export interface MailMessage {
  to: string;
  subject: string;
  /** Düz metin gövde. HTML okumayan istemciler için DAİMA doldurulur. */
  text: string;
  /** Biçimli gövde. */
  html: string;
}

/**
 * E-posta gönderimi — SÜRÜCÜ SOYUTLAMASI.
 *
 * İki sürücü vardır ve `MAIL_DRIVER` ortam değişkeniyle seçilir:
 *
 *   log  : gövdeyi loglar, hiçbir yere göndermez. Geliştirme ve test
 *          varsayılanı. Doğrulama bağlantısı log'dan okunup elle açılabilir.
 *   smtp : gerçek SMTP sunucusuna gönderir.
 *
 * NEDEN SOYUTLAMA:
 *   1. Geliştirme sırasında gerçek posta göndermek istemiyoruz; test
 *      kullanıcılarının adresine e-posta gitmesi kabul edilemez.
 *   2. e2e testleri jetonu doğrudan veritabanından okur ama akışın SMTP'ye
 *      bağımlı olmaması gerekir — testte ağ çağrısı olmamalı.
 *   3. Sağlayıcı değişimi (SMTP -> API tabanlı bir servis) tek sınıf
 *      eklemekle sınırlı kalır.
 *
 * GÖNDERİM HATASI ASIL İŞLEMİ BOZMAZ: `send` hata FIRLATMAZ, `false` döner.
 * Gerekçe, çağıran taraflarda ayrıntılı yazılıdır — kısaca: SMTP sunucusunun
 * geçici arızası yüzünden bir kaydın oluşmaması ya da bir şifre sıfırlama
 * isteğinin varlığının ele verilmesi istenmez.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /**
   * SMTP bağlantısı TEMBEL kurulur ve yeniden kullanılır.
   *
   * Her e-postada yeni bağlantı açmak TLS el sıkışmasını her seferinde
   * tekrarlardı; nodemailer'ın havuzu bunu tek bağlantı üzerinden yürütür.
   */
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {}

  /**
   * E-postayı gönderir.
   *
   * @returns Gönderim başarılıysa `true`. Hata durumunda `false` — ASLA
   *          fırlatmaz.
   */
  async send(message: MailMessage): Promise<boolean> {
    if (this.config.mailDriver === 'log') {
      this.logToConsole(message);

      return true;
    }

    try {
      await this.resolveTransporter().sendMail({
        from: { name: this.config.mailFromName, address: this.config.mailFromAddress },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      this.logger.log(`E-posta gönderildi: ${message.subject} -> ${maskEmail(message.to)}`);

      return true;
    } catch (error) {
      // Adres LOGA MASKELİ yazılır: log dosyaları genelde daha geniş bir
      // ekip tarafından okunur ve müşteri e-postası kişisel veridir (KVKK).
      this.logger.error(
        `E-posta gönderilemedi (${maskEmail(message.to)}): ${message.subject}`,
        error instanceof Error ? error.stack : String(error),
      );

      return false;
    }
  }

  private resolveTransporter(): Transporter {
    if (this.transporter !== null) {
      return this.transporter;
    }

    const host = this.config.smtpHost;

    if (host === undefined || host.trim() === '') {
      // Ortam doğrulaması (env.validation.ts) MAIL_DRIVER=smtp iken
      // SMTP_HOST'u zorunlu kılar; buraya düşmek yapılandırma hatasıdır.
      throw new Error('MAIL_DRIVER=smtp iken SMTP_HOST tanımlı olmalıdır.');
    }

    const user = this.config.smtpUser;
    const pass = this.config.smtpPassword;

    this.transporter = createTransport({
      host,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      // Kimlik doğrulaması OLMAYAN SMTP relay'leri vardır (şirket içi posta
      // sunucusu). Kullanıcı adı verilmediyse `auth` hiç gönderilmez.
      ...(user !== undefined && user !== '' ? { auth: { user, pass: pass ?? '' } } : {}),
    });

    return this.transporter;
  }

  /**
   * Geliştirme sürücüsü: e-postayı okunabilir biçimde loglar.
   *
   * Düz metin gövde loglanır, HTML DEĞİL: geliştiricinin ihtiyacı bağlantıyı
   * kopyalamaktır, etiket yığınını okumak değil.
   */
  private logToConsole(message: MailMessage): void {
    this.logger.log(
      [
        '',
        '──────── E-POSTA (MAIL_DRIVER=log — gönderilmedi) ────────',
        `Kime   : ${message.to}`,
        `Konu   : ${message.subject}`,
        '',
        message.text,
        '──────────────────────────────────────────────────────────',
      ].join('\n'),
    );
  }
}

/**
 * E-posta adresini loglama için maskeler: `ahmet@ornek.com` -> `a***t@ornek.com`.
 *
 * Alan adı korunur (teslimat sorunlarını teşhis etmek için gerekir), yerel
 * kısım gizlenir.
 */
export function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf('@');

  if (atIndex <= 0) {
    return '***';
  }

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  if (local.length <= 2) {
    return `${local.slice(0, 1)}***${domain}`;
  }

  return `${local.slice(0, 1)}***${local.slice(-1)}${domain}`;
}
