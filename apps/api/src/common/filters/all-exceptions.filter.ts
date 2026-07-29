import { randomUUID } from 'node:crypto';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  type ApiErrorDetail,
  type ApiErrorResponse,
} from '@zirve/types';

import { AppConfig } from '../../config/app.config';
import { AppException } from '../exceptions/app.exception';

/** Filtrenin ürettiği ara sonuç. */
interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details: ApiErrorDetail[];
  /** Sunucu logunda tutulacak, istemciye gönderilmeyecek ayrıntı. */
  internal?: unknown;
}

/**
 * Global hata filtresi — SPEC §14 standart hata formatını üretir:
 *
 *   { "success": false, "error": { "code", "message", "details": [] } }
 *
 * Sorumlulukları:
 *   - AppException, HttpException, Prisma hataları ve bilinmeyen hataları normalize eder
 *   - Üretimde stack trace ve veritabanı ayrıntısını istemciden gizler (§11.1)
 *   - Her 5xx hataya izlenebilir bir requestId iliştirir
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfig,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const normalized = this.normalize(exception);
    const requestId = randomUUID();

    this.log(normalized, exception, requestId, request);

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: this.buildDetails(normalized, requestId),
      },
    };

    httpAdapter.reply(ctx.getResponse(), body, normalized.status);
  }

  /**
   * 5xx hatalarda istemciye requestId verilir; kullanıcı destek talebinde
   * bu kodu ilettiğinde sunucu logunda tam ayrıntı bulunabilir.
   *
   * Dahili ayrıntı (Prisma mesajı, stack) YALNIZCA üretim dışında eklenir —
   * üretimde sızdırılmaz (docs/ARCHITECTURE.md §11.1).
   */
  private buildDetails(normalized: NormalizedError, requestId: string): ApiErrorDetail[] {
    if (normalized.status < HttpStatus.INTERNAL_SERVER_ERROR) {
      return normalized.details;
    }

    const details: ApiErrorDetail[] = [
      ...normalized.details,
      { field: 'requestId', message: requestId },
    ];

    if (!this.config.isProduction && normalized.internal !== undefined) {
      details.push({ field: 'debug', message: stringifyInternal(normalized.internal) });
    }

    return details;
  }

  private log(
    normalized: NormalizedError,
    exception: unknown,
    requestId: string,
    request: { method?: string; url?: string },
  ): void {
    const where = `${request.method ?? '-'} ${request.url ?? '-'}`;
    const prefix = `[${requestId}] ${where} -> ${normalized.status} ${normalized.code}`;

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const internalNote =
        normalized.internal === undefined ? '' : ` | ${stringifyInternal(normalized.internal)}`;

      this.logger.error(
        `${prefix} :: ${normalized.message}${internalNote}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    // 4xx beklenen durumdur; gürültü yapmamak için debug seviyesinde loglanır.
    this.logger.debug(`${prefix} :: ${normalized.message}`);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnownError(exception);
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: ERROR_MESSAGES[ERROR_CODES.SERVICE_UNAVAILABLE],
        details: [],
        internal: exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Bu, sunucu tarafı bir programlama hatasıdır; ayrıntı sızdırılmaz.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR],
        details: [],
        internal: exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR],
      details: [],
      internal: exception,
    };
  }

  /**
   * NestJS'in yerleşik HttpException'larını (ValidationPipe, ThrottlerGuard,
   * NotFoundException vb.) standart formata çevirir.
   */
  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const response = exception.getResponse();

    // AppException dışındaki bir yerden { code, message, details } geldiyse onu kullan.
    if (isStructuredErrorPayload(response)) {
      return {
        status,
        code: response.code,
        message: response.message,
        details: response.details ?? [],
      };
    }

    // ValidationPipe: { message: string[], error: string, statusCode: number }
    if (isValidationPayload(response)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: ERROR_MESSAGES[ERROR_CODES.VALIDATION_ERROR],
        details: response.message.map((message) => ({ message })),
      };
    }

    const message =
      typeof response === 'string'
        ? response
        : isPlainMessagePayload(response)
          ? response.message
          : exception.message;

    return {
      status,
      code: this.codeForStatus(status),
      message,
      details: [],
    };
  }

  /** Prisma'nın bilinen hata kodlarını anlamlı HTTP durumlarına eşler. */
  private fromPrismaKnownError(exception: Prisma.PrismaClientKnownRequestError): NormalizedError {
    switch (exception.code) {
      // Benzersizlik ihlali
      case 'P2002': {
        const target = exception.meta?.['target'];
        const fields = Array.isArray(target) ? target.map(String) : [];

        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'Bu kayıt zaten mevcut.',
          details: fields.map((field) => ({
            field,
            message: `${field} alanı benzersiz olmalıdır.`,
          })),
        };
      }

      // Yabancı anahtar ihlali
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'İlişkili kayıt nedeniyle işlem tamamlanamadı.',
          details: [],
        };

      // Silme kısıtı (Restrict) — bağlı kayıt var
      case 'P2014':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'Bu kayda bağlı başka kayıtlar olduğu için işlem yapılamıyor.',
          details: [],
        };

      // Kayıt bulunamadı
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: ERROR_MESSAGES[ERROR_CODES.NOT_FOUND],
          details: [],
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR],
          details: [],
          internal: `Prisma ${exception.code}: ${exception.message}`,
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODES.UNPROCESSABLE;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMIT_EXCEEDED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ERROR_CODES.SERVICE_UNAVAILABLE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ERROR_CODES.INTERNAL_ERROR
          : ERROR_CODES.BAD_REQUEST;
    }
  }
}

/** Dahili hata ayrıntısını log/debug için okunabilir metne çevirir. */
function stringifyInternal(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isStructuredErrorPayload(
  value: unknown,
): value is { code: string; message: string; details?: ApiErrorDetail[] } {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { code?: unknown; message?: unknown };

  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

function isValidationPayload(value: unknown): value is { message: string[] } {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { message?: unknown };

  return (
    Array.isArray(candidate.message) && candidate.message.every((item) => typeof item === 'string')
  );
}

function isPlainMessagePayload(value: unknown): value is { message: string } {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { message?: unknown }).message === 'string';
}
