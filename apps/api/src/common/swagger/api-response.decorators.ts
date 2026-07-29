import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Swagger'da SPEC §14 standart yanıt formatını gösteren dekoratörler.
 *
 * ResponseInterceptor yanıtı çalışma zamanında sarmaladığı için Swagger
 * şeması otomatik olarak doğru çıkmaz; bu dekoratörler sarmalanmış hâli
 * dokümantasyona yansıtır.
 */

/** Tekil kayıt döndüren başarılı yanıt. */
export function ApiStandardResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: { status?: number; description?: string } = {},
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description ?? 'İşlem başarılı.',
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: getSchemaPath(model) },
        },
      },
    }),
  );
}

/** Sayfalanmış liste döndüren başarılı yanıt. */
export function ApiPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: { description?: string } = {},
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: 200,
      description: options.description ?? 'Liste başarıyla getirildi.',
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          meta: {
            type: 'object',
            required: ['page', 'limit', 'total', 'totalPages'],
            properties: {
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              total: { type: 'integer', example: 137 },
              totalPages: { type: 'integer', example: 7 },
            },
          },
        },
      },
    }),
  );
}

/** Standart hata yanıtı. */
export function ApiErrorResponse(status: number, code: string, description: string) {
  return ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          required: ['code', 'message', 'details'],
          properties: {
            code: { type: 'string', example: code },
            message: { type: 'string', example: description },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'items[2].quantity' },
                  message: { type: 'string', example: 'Miktar 0’dan büyük olmalıdır.' },
                },
              },
            },
          },
        },
      },
    },
  });
}
