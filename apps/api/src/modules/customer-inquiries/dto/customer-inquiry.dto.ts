import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength } from 'class-validator';

/**
 * Talep numarası biçimi — `TLP-2026-000042`.
 *
 * Veritabanındaki `chk_inquiries_number_format` kısıtıyla AYNI kuralı uygular
 * (2-6 harflik ön ek, yıl, sıra numarası).
 *
 * NEDEN DOĞRULANIYOR: bu değer adres yolundan gelir ve doğrudan bir `where`
 * koşuluna girer. Prisma parametreli sorgu kurduğu için enjeksiyon riski yok
 * ama serbest bırakmak, 200 karakterlik girdilerle indeks taraması yapılmasına
 * izin verirdi. Biçim uymuyorsa sorgu hiç kurulmaz.
 */
const INQUIRY_NUMBER_PATTERN = /^[A-Z]{2,6}-\d{4}-\d{6}$/;

export class InquiryNumberParamDto {
  @ApiProperty({ example: 'TLP-2026-000042', description: 'Talep numarası.' })
  @MaxLength(32)
  @Matches(INQUIRY_NUMBER_PATTERN, { message: 'Talep numarası biçimi geçersiz.' })
  inquiryNumber!: string;
}
