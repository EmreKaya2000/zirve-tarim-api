import { buildTree } from './categories.service';

/** Test verisi üretmek için kısa yardımcı. */
function cat(id: string, parentId: string | null, name: string, sortOrder = 0) {
  return {
    id,
    parentId,
    name,
    slug: name.toLowerCase(),
    description: null,
    iconUrl: null,
    imageUrl: null,
    sortOrder,
    isActive: true,
  };
}

describe('buildTree', () => {
  it('düz listeden hiyerarşi kurar', () => {
    const tree = buildTree([
      cat('1', null, 'Gubre'),
      cat('2', '1', 'Kati'),
      cat('3', '1', 'Sivi'),
      cat('4', '2', 'Kompoze'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('Gubre');
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.children[0]?.name).toBe('Kompoze');
  });

  it('her düğüme doğru derinlik yazar', () => {
    const tree = buildTree([
      cat('1', null, 'Kok'),
      cat('2', '1', 'Seviye1'),
      cat('3', '2', 'Seviye2'),
      cat('4', '3', 'Seviye3'),
    ]);

    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.depth).toBe(3);
  });

  it('birden çok kök kategoriyi destekler', () => {
    const tree = buildTree([
      cat('1', null, 'Gubre'),
      cat('2', null, 'Tohum'),
      cat('3', '1', 'Kati'),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree.map((node) => node.name)).toEqual(['Gubre', 'Tohum']);
  });

  it('girdi sırasını korur (sıralama sorguda yapılır)', () => {
    const tree = buildTree([
      cat('1', null, 'Kok'),
      cat('3', '1', 'Ucuncu', 3),
      cat('2', '1', 'Ikinci', 2),
    ]);

    expect(tree[0]?.children.map((child) => child.name)).toEqual(['Ucuncu', 'Ikinci']);
  });

  it('boş listede boş dizi döner', () => {
    expect(buildTree([])).toEqual([]);
  });

  describe('öksüz düğümler', () => {
    // Public ağaçta üstü pasif olan kategori listeden elenir. Alt kategorisi
    // köke TERFİ ETMEMELİDİR: pasif bir üstün altındaki kategori public
    // tarafta hiç görünmemelidir.
    it('üstü listede olmayan düğümü ağaca ALMAZ', () => {
      const tree = buildTree([cat('1', null, 'Gorunur'), cat('3', 'gizli-ust', 'Oksuz')]);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.name).toBe('Gorunur');
    });

    it('öksüz düğümün alt ağacı da dışarıda kalır', () => {
      const tree = buildTree([
        cat('1', null, 'Gorunur'),
        cat('2', 'gizli-ust', 'Oksuz'),
        cat('3', '2', 'OksuzunCocugu'),
      ]);

      expect(tree).toHaveLength(1);
      expect(JSON.stringify(tree)).not.toContain('Oksuz');
    });
  });

  it('derin hiyerarşiyi doğru kurar (5 seviye)', () => {
    const tree = buildTree([
      cat('1', null, 'S0'),
      cat('2', '1', 'S1'),
      cat('3', '2', 'S2'),
      cat('4', '3', 'S3'),
      cat('5', '4', 'S4'),
    ]);

    let node = tree[0];
    const names: string[] = [];

    while (node !== undefined) {
      names.push(node.name);
      node = node.children[0];
    }

    expect(names).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
  });
});
