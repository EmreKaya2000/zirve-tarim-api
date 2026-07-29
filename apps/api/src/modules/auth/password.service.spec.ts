import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  // Argon2 kasıtlı olarak yavaştır; bu testler varsayılan 5sn'yi aşabilir.
  jest.setTimeout(30_000);

  it('şifreyi özetler ve ham şifreyi ASLA içermez', async () => {
    const password = 'CokGuvenliSifre123';
    const hashed = await service.hash(password);

    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(hashed).not.toContain(password);
  });

  it('aynı şifre için her seferinde farklı hash üretir (rastgele tuz)', async () => {
    const first = await service.hash('AyniSifre123');
    const second = await service.hash('AyniSifre123');

    expect(first).not.toBe(second);
  });

  it('doğru şifreyi doğrular', async () => {
    const hashed = await service.hash('DogruSifre123');

    await expect(service.verify(hashed, 'DogruSifre123')).resolves.toBe(true);
  });

  it('yanlış şifreyi reddeder', async () => {
    const hashed = await service.hash('DogruSifre123');

    await expect(service.verify(hashed, 'YanlisSifre123')).resolves.toBe(false);
  });

  it('büyük/küçük harf duyarlıdır', async () => {
    const hashed = await service.hash('Sifre123');

    await expect(service.verify(hashed, 'sifre123')).resolves.toBe(false);
  });

  it('Türkçe karakter içeren şifreyi doğru işler', async () => {
    const password = 'ÇiftçiŞifresi123';
    const hashed = await service.hash(password);

    await expect(service.verify(hashed, password)).resolves.toBe(true);
  });

  it('bozuk hash formatında hata fırlatmaz, false döner', async () => {
    await expect(service.verify('bu-bir-hash-degil', 'herhangi')).resolves.toBe(false);
    await expect(service.verify('', 'herhangi')).resolves.toBe(false);
  });
});
