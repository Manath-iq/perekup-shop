import { describe, expect, it } from 'vitest';
import { matchesQuery, nearest, parseQuery, queryChips, withoutChip } from './search';

const apple = { defaultBrand: 'apple' };

describe('умный поиск', () => {
  it('сленг из макета: «15 про 256 до 60к»', () => {
    const q = parseQuery('15 про 256 до 60к', apple);
    expect(q).toEqual({ model: expect.objectContaining({ id: 'iphone-15-pro' }), storage_gb: 256, price_max: 60000 });
    expect(queryChips(q).map((c) => c.label)).toEqual(['iPhone 15 Pro', '256 ГБ', 'до 60 000 ₽']);
  });

  it.each([
    ['айфон 13 мини акб 90', { model: 'iphone-13-mini', battery_min: 90 }],
    ['iphone 16 pro max 1тб', { model: 'iphone-16-pro-max', storage_gb: 1024 }],
    ['самсунг с24 ультра дешевле 70 000', { model: 'galaxy-s24-ultra', price_max: 70000 }],
    ['макбук эйр м2 от 50к', { model: 'macbook-air', chip: 'M2', price_min: 50000 }],
    ['макбук м3 про', { line: 'MacBook', chip: 'M3 Pro' }],
    ['айфон 40-60к', { line: 'iPhone', price_min: 40000, price_max: 60000 }],
    ['airpods pro 2 полный комплект', { model: 'airpods-pro-2', full_kit: true }],
    ['14 pro физ сим', { model: 'iphone-14-pro', physical_sim: true }],
  ])('%s', (input, want) => {
    const q = parseQuery(input, apple);
    const { model, ...rest } = want as { model?: string };
    if (model) expect(q.model?.id).toBe(model);
    expect(q).toMatchObject(rest);
  });

  it('без бренда магазина «15 про» — не модель', () => {
    expect(parseQuery('15 про').model).toBeUndefined();
  });

  it('чипы снимаются по одному', () => {
    const q = parseQuery('15 про 256 до 60к', apple);
    expect(withoutChip(q, 'storage_gb')).not.toHaveProperty('storage_gb');
    expect(withoutChip(q, 'storage_gb').model?.id).toBe('iphone-15-pro');
  });

  const items = [
    { model_id: 'iphone-15-pro', line: 'iPhone', brand: 'apple', title: 'iPhone 15 Pro', price: 45990, attrs: { storage_gb: 128, battery_pct: 88 } },
    { model_id: 'iphone-16-pro', line: 'iPhone', brand: 'apple', title: 'iPhone 16 Pro', price: 66990, attrs: { storage_gb: 512, battery_pct: 89 } },
    { model_id: 'iphone-13', line: 'iPhone', brand: 'apple', title: 'iPhone 13', price: 14990, attrs: { storage_gb: 128, battery_pct: 83 } },
  ];

  it('фильтрует и находит ближайшее, когда точного нет', () => {
    const q = parseQuery('15 про 256 до 60к', apple);
    expect(items.filter((l) => matchesQuery(l, q))).toEqual([]);
    expect(nearest(items, q)).toEqual({ item: items[0], diff: '128 вместо 256' });
    expect(items.filter((l) => matchesQuery(l, parseQuery('айфон до 50к', apple))).map((l) => l.model_id)).toEqual(['iphone-15-pro', 'iphone-13']);
  });
});
