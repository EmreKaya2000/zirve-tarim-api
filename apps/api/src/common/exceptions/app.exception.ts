import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, ERROR_MESSAGES, type ApiErrorDetail, type ErrorCode } from '@zirve/types';

/**
 * Uygulamanın kendi hata tipi.
 *
 * NestJS'in hazır `NotFoundException` vb. sınıfları yerine bunu kullanmak,
 * her hatanın makine-okunur bir `code` taşımasını garanti eder (SPEC §14).
 * `AllExceptionsFilter` bu sınıfı tanır ve doğrudan standart formata çevirir.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode | string;
  readonly details: ApiErrorDetail[];

  constructor(
    code: ErrorCode | string,
    message: string,
    status: HttpStatus,
    details: ApiErrorDetail[] = [],
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }

  /** 404 — Kayıt bulunamadı. */
  static notFound(message?: string, details: ApiErrorDetail[] = []): AppException {
    return new AppException(
      ERROR_CODES.NOT_FOUND,
      message ?? ERROR_MESSAGES[ERROR_CODES.NOT_FOUND],
      HttpStatus.NOT_FOUND,
      details,
    );
  }

  /** 409 — Benzersizlik veya durum çakışması. */
  static conflict(message?: string, details: ApiErrorDetail[] = []): AppException {
    return new AppException(
      ERROR_CODES.CONFLICT,
      message ?? ERROR_MESSAGES[ERROR_CODES.CONFLICT],
      HttpStatus.CONFLICT,
      details,
    );
  }

  /**
   * 422 — İş kuralı ihlali.
   *
   * Şema doğru ama işlem iş kuralları nedeniyle yapılamıyor
   * (ör. yetersiz stok, kredi limiti aşımı).
   */
  static unprocessable(
    code: ErrorCode | string,
    message: string,
    details: ApiErrorDetail[] = [],
  ): AppException {
    return new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  /** 400 — Geçersiz istek. */
  static badRequest(message?: string, details: ApiErrorDetail[] = []): AppException {
    return new AppException(
      ERROR_CODES.BAD_REQUEST,
      message ?? ERROR_MESSAGES[ERROR_CODES.BAD_REQUEST],
      HttpStatus.BAD_REQUEST,
      details,
    );
  }

  /** 401 — Kimlik doğrulanamadı. */
  static unauthorized(code: ErrorCode = ERROR_CODES.UNAUTHORIZED, message?: string): AppException {
    return new AppException(
      code,
      message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED],
      HttpStatus.UNAUTHORIZED,
    );
  }

  /** 403 — Yetki yok. */
  static forbidden(message?: string): AppException {
    return new AppException(
      ERROR_CODES.FORBIDDEN,
      message ?? ERROR_MESSAGES[ERROR_CODES.FORBIDDEN],
      HttpStatus.FORBIDDEN,
    );
  }

  /** 503 — Servis geçici olarak kullanılamıyor. */
  static serviceUnavailable(message?: string, details: ApiErrorDetail[] = []): AppException {
    return new AppException(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      message ?? ERROR_MESSAGES[ERROR_CODES.SERVICE_UNAVAILABLE],
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}
