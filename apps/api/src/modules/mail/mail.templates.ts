import type { MailMessage } from './mail.service';

/**
 * E-posta şablonları.
 *
 * Şablon motoru KULLANILMADI. Sprint 11'de üç e-posta var ve hepsi tek bir
 * bağlantı taşıyor; bir motor eklemek (dosya çözümleme, derleme, ayrı test
 * yolu) bu hacimde kazançtan çok bakım yükü olurdu. Şablon sayısı arttığında
 * imza aynı kalarak motora geçilebilir: her işlev `MailMessage` döndürür.
 *
 * HER ŞABLON HEM METİN HEM HTML ÜRETİR: e-posta istemcilerinin bir bölümü
 * HTML'i engeller ve yalnız metin gövdesini gösterir. Bağlantı iki gövdede de
 * TAM URL olarak yazılır — "buraya tıklayın" metni, metin gövdesinde
 * kullanılamaz hâle gelirdi.
 */

/** Ortak sayfa iskeleti — satır içi stil, çünkü e-posta istemcileri <style> etiketini atar. */
function wrapHtml(heading: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${text}</p>`,
    )
    .join('');

  const button =
    action === undefined
      ? ''
      : `<p style="margin:0 0 24px;"><a href="${action.url}" style="display:inline-block;` +
        `background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 24px;` +
        `border-radius:8px;font-size:15px;font-weight:600;">${action.label}</a></p>` +
        `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280;">` +
        `Düğme çalışmazsa bu adresi tarayıcınıza kopyalayın:<br />` +
        `<span style="word-break:break-all;">${action.url}</span></p>`;

  return (
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;` +
    `margin:0 auto;padding:24px;">` +
    `<h1 style="margin:0 0 20px;font-size:20px;color:#1b1b1b;">${heading}</h1>` +
    body +
    button +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">` +
    `Bu e-posta Zirve Tarım tarafından gönderildi. Bu işlemi siz başlatmadıysanız ` +
    `dikkate almanıza gerek yok.</p>` +
    `</div>`
  );
}

/** E-posta doğrulama bağlantısı. */
export function buildVerificationMail(params: {
  to: string;
  firstName: string;
  verifyUrl: string;
  expiresInHours: number;
}): MailMessage {
  const { to, firstName, verifyUrl, expiresInHours } = params;

  return {
    to,
    subject: 'Zirve Tarım — E-posta adresinizi doğrulayın',
    text: [
      `Merhaba ${firstName},`,
      '',
      'Zirve Tarım hesabınızı doğrulamak için aşağıdaki bağlantıyı açın:',
      verifyUrl,
      '',
      `Bağlantı ${expiresInHours} saat geçerlidir ve yalnız bir kez kullanılabilir.`,
      '',
      'Doğrulamadan sonra, aynı e-posta adresiyle daha önce gönderdiğiniz talepler',
      'de hesabınıza taşınır ve "Taleplerim" sayfasında görünür.',
      '',
      'Bu işlemi siz başlatmadıysanız bu e-postayı dikkate almayın.',
    ].join('\n'),
    html: wrapHtml(
      'E-posta adresinizi doğrulayın',
      [
        `Merhaba <strong>${escapeHtml(firstName)}</strong>,`,
        'Hesabınızı doğrulamak için aşağıdaki düğmeye dokunun.',
        `Bağlantı <strong>${expiresInHours} saat</strong> geçerlidir ve yalnız bir kez kullanılabilir.`,
        'Doğrulamadan sonra aynı e-posta adresiyle daha önce gönderdiğiniz talepler de ' +
          'hesabınıza taşınır.',
      ],
      { label: 'E-postamı doğrula', url: verifyUrl },
    ),
  };
}

/** Şifre sıfırlama bağlantısı. */
export function buildPasswordResetMail(params: {
  to: string;
  firstName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, firstName, resetUrl, expiresInMinutes } = params;

  return {
    to,
    subject: 'Zirve Tarım — Şifre sıfırlama',
    text: [
      `Merhaba ${firstName},`,
      '',
      'Şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:',
      resetUrl,
      '',
      `Bağlantı ${expiresInMinutes} dakika geçerlidir ve yalnız bir kez kullanılabilir.`,
      '',
      'Bu isteği siz yapmadıysanız hiçbir şey yapmanız gerekmiyor; şifreniz',
      'değişmedi. Bağlantı süresi dolduğunda kendiliğinden geçersiz olur.',
    ].join('\n'),
    html: wrapHtml(
      'Şifrenizi sıfırlayın',
      [
        `Merhaba <strong>${escapeHtml(firstName)}</strong>,`,
        'Yeni bir şifre belirlemek için aşağıdaki düğmeye dokunun.',
        `Bağlantı <strong>${expiresInMinutes} dakika</strong> geçerlidir ve yalnız bir kez kullanılabilir.`,
        'Bu isteği siz yapmadıysanız şifreniz değişmedi; bu e-postayı dikkate almayın.',
      ],
      { label: 'Yeni şifre belirle', url: resetUrl },
    ),
  };
}

/**
 * Şifre değişti bildirimi.
 *
 * NEDEN GÖNDERİLİR: hesabı ele geçirilen kullanıcının bunu öğrenmesinin tek
 * yolu budur. Sıfırlamayı yapan zaten ekranda sonucu görür; bu e-posta
 * YAPMAYAN kişi için vardır.
 */
export function buildPasswordChangedMail(params: {
  to: string;
  firstName: string;
  supportUrl: string;
}): MailMessage {
  const { to, firstName, supportUrl } = params;

  return {
    to,
    subject: 'Zirve Tarım — Şifreniz değiştirildi',
    text: [
      `Merhaba ${firstName},`,
      '',
      'Hesabınızın şifresi az önce değiştirildi ve açık tüm oturumlar kapatıldı.',
      '',
      'Bu işlemi siz yapmadıysanız hemen bizimle iletişime geçin:',
      supportUrl,
    ].join('\n'),
    html: wrapHtml(
      'Şifreniz değiştirildi',
      [
        `Merhaba <strong>${escapeHtml(firstName)}</strong>,`,
        'Hesabınızın şifresi az önce değiştirildi ve açık tüm oturumlar kapatıldı.',
        `Bu işlemi siz yapmadıysanız hemen <a href="${supportUrl}">bizimle iletişime geçin</a>.`,
      ],
      undefined,
    ),
  };
}

/**
 * HTML'e gömülen kullanıcı verisini kaçırır.
 *
 * Ad ve soyad kullanıcının yazdığı serbest metindir. Kaçırılmazsa e-posta
 * gövdesine etiket enjekte edilebilirdi — kendi adresine gönderilen bir
 * e-postada zararsız görünür ama şablon ileride başka bir alıcıya (ör.
 * yöneticiye bildirim) gönderilirse gerçek bir açığa dönüşür.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
