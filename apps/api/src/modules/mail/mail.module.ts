import { Module } from '@nestjs/common';

import { MailService } from './mail.service';

/**
 * E-posta modülü (Sprint 11).
 *
 * Denetleyicisi YOKTUR: e-posta bir uç değil, diğer modüllerin kullandığı bir
 * yetenektir. Sürücü seçimi `MAIL_DRIVER` ile yapılır (bkz. MailService).
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
