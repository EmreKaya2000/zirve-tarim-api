import { StreamableFile, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { ResponseInterceptor } from './response.interceptor';

/**
 * SPEC §14 başarılı yanıt formatının sözleşme testi.
 * Bu davranış tüm istemcilerin (web + ileride mobil) bağlı olduğu tek kuraldır.
 */
describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();
  const context = {} as ExecutionContext;

  const run = async (payload: unknown): Promise<unknown> => {
    const handler: CallHandler = { handle: () => of(payload) };

    return firstValueFrom(interceptor.intercept(context, handler));
  };

  describe('tekil veri', () => {
    it('nesneyi { success, data } içine sarar', async () => {
      await expect(run({ id: '1', name: 'Üre Gübre' })).resolves.toEqual({
        success: true,
        data: { id: '1', name: 'Üre Gübre' },
      });
    });

    it('meta eklemez', async () => {
      const result = (await run({ id: '1' })) as Record<string, unknown>;

      expect(result).not.toHaveProperty('meta');
    });

    it('undefined yanıtı null a çevirir', async () => {
      await expect(run(undefined)).resolves.toEqual({ success: true, data: null });
    });

    it('null yanıtı korur', async () => {
      await expect(run(null)).resolves.toEqual({ success: true, data: null });
    });

    it('ilkel değerleri sarar', async () => {
      await expect(run('metin')).resolves.toEqual({ success: true, data: 'metin' });
      await expect(run(42)).resolves.toEqual({ success: true, data: 42 });
      // false değeri null a dönüşmemeli.
      await expect(run(false)).resolves.toEqual({ success: true, data: false });
    });

    it('düz diziyi meta olmadan sarar', async () => {
      await expect(run([1, 2, 3])).resolves.toEqual({ success: true, data: [1, 2, 3] });
    });
  });

  describe('sayfalanmış sonuç', () => {
    const paginated = {
      items: [{ id: '1' }, { id: '2' }],
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    };

    it('items i data ya, meta yı meta ya taşır', async () => {
      await expect(run(paginated)).resolves.toEqual({
        success: true,
        data: [{ id: '1' }, { id: '2' }],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });
    });

    it('boş liste için de meta üretir', async () => {
      await expect(
        run({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
      ).resolves.toEqual({
        success: true,
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('eksik meta alanı olan nesneyi sayfalanmış saymaz', async () => {
      const almost = { items: [{ id: '1' }], meta: { page: 1, limit: 20 } };

      await expect(run(almost)).resolves.toEqual({ success: true, data: almost });
    });

    it('items alanı dizi değilse sayfalanmış saymaz', async () => {
      const notPaginated = {
        items: 'iki',
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      };

      await expect(run(notPaginated)).resolves.toEqual({ success: true, data: notPaginated });
    });
  });

  describe('stream yanıtı', () => {
    it('StreamableFile i sarmadan geçirir', async () => {
      const file = new StreamableFile(Buffer.from('rapor'));

      await expect(run(file)).resolves.toBe(file);
    });
  });
});
