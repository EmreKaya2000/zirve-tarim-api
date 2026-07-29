import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parametreleri.
 *
 * OWASP Password Storage Cheat Sheet asgari önerisi:
 * m=19 MiB, t=2, p=1. Bellek maliyeti GPU saldırılarına karşı asıl korumadır.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Şifre özetleme ve doğrulama.
 *
 * Ham şifre hiçbir yerde saklanmaz, loglanmaz veya denetim kaydına yazılmaz
 * (AuditLogsService bu alanları maskeler).
 */
@Injectable()
export class PasswordService {
  /** Ham şifreden Argon2id özeti üretir. */
  async hash(plainPassword: string): Promise<string> {
    return hash(plainPassword, ARGON2_OPTIONS);
  }

  /**
   * Şifreyi özetle karşılaştırır.
   *
   * Bozuk/eski formatlı bir hash'te `verify` hata fırlatır; bu durumda
   * doğrulama başarısız sayılır — hata dışarı sızdırılmaz.
   */
  async verify(hashedPassword: string, plainPassword: string): Promise<boolean> {
    try {
      return await verify(hashedPassword, plainPassword, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}
