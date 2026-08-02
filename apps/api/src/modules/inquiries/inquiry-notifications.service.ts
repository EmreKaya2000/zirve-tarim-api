import { Injectable, Logger } from '@nestjs/common';
import { INQUIRY_STATUS_LABELS, type InquiryStatus } from '@zirve/types';

import { AppConfig } from '../../config/app.config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  buildInquiryNewAdminMail,
  buildInquiryReceivedMail,
  buildInquiryStatusChangedMail,
  type InquiryMailItem,
} from '../mail/mail.templates';
import { MailService } from '../mail/mail.service';

/**
 * Talep e-postaları.
 *
 * =============================================================================
 * GÖNDERİM ANA İŞLEMİ ASLA BLOKLAMAZ
 * =============================================================================
 * Bütün metotlar `void` döner ve İÇERİDE hata yutar. Sebep: talep kaydı zaten
 * commit edilmiştir. SMTP sunucusunun geçici arızası yüzünden istemciye 500
 * dönmek, kullanıcıyı formu yeniden göndermeye iter ve AYNI talep ikinci kez
 * oluşur — yani bildirim hatası veri bozukluğuna dönüşür.
 *
 * Bu yüzden çağrı tarafında `await` EDİLMEZ. `MailService.send` zaten
 * fırlatmaz ama buradaki veritabanı okuması fırlatabilir; onu da yutuyoruz.
 *
 * =============================================================================
 * NEDEN AYRI SERVİS
 * =============================================================================
 * `InquiriesService` transaction, doğrulama ve durum makinesi taşıyor. Mail
 * kurgusunu (kime, hangi şablon, hangi durumda) oraya koymak o sınıfı iki
 * ayrı sorumlulukla doldururdu. Ayrıca burada test etmek kolay: e-posta
 * kararları veritabanı transaction'ı olmadan doğrulanabiliyor.
 */
@Injectable()
export class InquiryNotificationsService {
  private readonly logger = new Logger(InquiryNotificationsService.name);

  /**
   * Müşteriye durum değişikliği e-postası gönderilen durumlar.
   *
   * Ara durumlar (REVIEWING, CONTACTED, QUOTED, APPROVED) mağazanın İÇ iş
   * akışıdır. Her geçişte e-posta atmak müşteriyi bilgilendirmez, spam eder
   * ve mağazanın iç sürecini dışarı sızdırır.
   *
   * ŞARTNAME "READY ve CANCELLED" DİYOR; `READY` BU SİSTEMDE YOK.
   * Gerçek durum makinesi: NEW, REVIEWING, CONTACTED, QUOTED, APPROVED,
   * CONVERTED_TO_SALE, COMPLETED, REJECTED, CANCELLED. Şartnamenin
   * kastettiği "müşterinin beklediği iş bitti" anlamının karşılığı
   * `COMPLETED`. Bu yüzden READY -> COMPLETED eşlendi.
   *
   * `REJECTED` BİLEREK DIŞARIDA: o da müşteriye bakan bir kapanış ve
   * bildirilmesi savunulabilir, ama şartname iki durum saydı; üçüncü bir
   * e-posta eklemek istenmeyen bildirim üretmek olurdu. Karar gerekirse
   * buraya tek satır eklenerek değiştirilir.
   */
  private static readonly NOTIFIED_STATUSES: readonly InquiryStatus[] = ['COMPLETED', 'CANCELLED'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Talep oluşturuldu: müşteriye onay, yönetime bildirim.
   *
   * Fire-and-forget. Çağıran `void` ile çağırmalıdır.
   */
  dispatchCreated(inquiryId: string): void {
    void this.safely('talep alındı bildirimi', async () => {
      const inquiry = await this.loadInquiry(inquiryId);

      if (inquiry === null) {
        return;
      }

      const items: InquiryMailItem[] = inquiry.items.map((item) => ({
        productName: item.productNameSnapshot,
        variantName: item.variantNameSnapshot,
        // Decimal -> string: miktar "2" degil "2.000" gelir, sondaki
        // anlamsiz sifirlar kirpilir.
        quantity: trimDecimal(item.quantity.toString()),
        unitName: item.unitTypeSnapshot,
      }));

      // Müşteriye: yalnız talepte e-posta verildiyse. Telefonla gelen
      // taleplerde adres yoktur ve bu normaldir.
      if (inquiry.contactEmail !== null) {
        await this.mail.send(
          buildInquiryReceivedMail({
            to: inquiry.contactEmail,
            contactName: inquiry.contactName,
            inquiryNumber: inquiry.inquiryNumber,
            items,
          }),
        );
      }

      // Yönetime: adres tanımlıysa. Tanımsız olması hata değildir.
      const adminEmail = this.config.adminNotificationEmail;

      if (adminEmail !== undefined) {
        await this.mail.send(
          buildInquiryNewAdminMail({
            to: adminEmail,
            inquiryNumber: inquiry.inquiryNumber,
            contactName: inquiry.contactName,
            contactPhone: inquiry.contactPhone,
            itemCount: inquiry.items.length,
            panelUrl: `${this.config.adminPanelUrl}/talepler/${inquiry.id}`,
          }),
        );
      }
    });
  }

  /**
   * Talep durumu değişti: yalnız COMPLETED ve CANCELLED müşteriye bildirilir.
   *
   * Fire-and-forget. Çağıran `void` ile çağırmalıdır.
   */
  dispatchStatusChanged(inquiryId: string, status: InquiryStatus): void {
    if (!InquiryNotificationsService.NOTIFIED_STATUSES.includes(status)) {
      return;
    }

    void this.safely('talep durum bildirimi', async () => {
      const inquiry = await this.loadInquiry(inquiryId);

      if (inquiry === null || inquiry.contactEmail === null) {
        return;
      }

      await this.mail.send(
        buildInquiryStatusChangedMail({
          to: inquiry.contactEmail,
          contactName: inquiry.contactName,
          inquiryNumber: inquiry.inquiryNumber,
          statusLabel: INQUIRY_STATUS_LABELS[status],
          isCancelled: status === 'CANCELLED',
        }),
      );
    });
  }

  /** Şablonların ihtiyaç duyduğu asgari alanlar. */
  private async loadInquiry(id: string) {
    return this.prisma.inquiry.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        inquiryNumber: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        items: {
          select: {
            productNameSnapshot: true,
            variantNameSnapshot: true,
            unitTypeSnapshot: true,
            quantity: true,
          },
        },
      },
    });
  }

  /** Hata yutan sarmalayıcı: bildirim hiçbir koşulda çağıranı düşürmez. */
  private async safely(label: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `${label} gönderilemedi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** "2.000" -> "2", "1.500" -> "1.5". Sondaki anlamsız sıfırları atar. */
function trimDecimal(value: string): string {
  if (!value.includes('.')) {
    return value;
  }

  return value.replace(/\.?0+$/, '');
}
