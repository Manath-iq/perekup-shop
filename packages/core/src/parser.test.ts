import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePost, parseModel, isListingPost } from './parser';
import { parseFeed } from './scrape';

const POST_1666 = `📱 iPhone 16 128GB
#АКТУАЛЬНО_RaXi

Состояние: Отличное 🔥
SIM + eSIM
✅ Акб 88%
✅ Экран без царапин, всегда в защитном стекле
✅ Камеры идеал
✅ Полный комплект
✅ Идеален по всем техническим характеристикам
✅ Не вскрывался
✅ Оригинальный провод
✖️ Следы от чехла по бокам

💰 43 990 ₽

Купить: @Raxi_Apple
Отзывы`;

const POST_1672 = `📱 iPhone 15 Pro Max 256GB
#АКТУАЛЬНО_RaXi

Состояние: Идеал 🔥
SIM + eSIM
✅ Акб 85%
✅ Экран без царапин, всегда в защитном стекле
✅ Корпус без дефектов
✅ Идеален по всем техническим характеристикам
✅ IOS 18.4
✅ Не вскрывался
✖️ Комплект: телефон, блок, провод

💰 49 990 ₽

Купить: @Raxi_Apple
Отзывы`;

describe('parsePost — примеры из ТЗ', () => {
  it('пост 1666', () => {
    const p = parsePost(POST_1666);
    expect(p).toMatchObject({
      category: 'iphone',
      family: '16',
      storage_gb: 128,
      status: 'active',
      condition: 'Отличное',
      sim: 'SIM + eSIM',
      has_physical_sim: true,
      battery_pct: 88,
      ios: null,
      kit: 'Полный комплект',
      full_kit: true,
      price_rub: 43990,
      parse_ok: true,
    });
    expect(p.pluses).not.toContain('Акб 88%');
    expect(p.pluses).toContain('Оригинальный провод');
    expect(p.nuances).toEqual(['Следы от чехла по бокам']);
  });

  it('пост 1672', () => {
    const p = parsePost(POST_1672);
    expect(p).toMatchObject({
      family: '15 Pro Max',
      storage_gb: 256,
      condition: 'Идеал',
      battery_pct: 85,
      ios: '18.4',
      kit: 'телефон, блок, провод',
      full_kit: false,
      price_rub: 49990,
      parse_ok: true,
    });
    expect(p.pluses.some((s) => /ios/i.test(s))).toBe(false);
    expect(p.nuances).toEqual(['Комплект: телефон, блок, провод']);
  });

  it('проданный пост без хэштега → sold', () => {
    const p = parsePost('❌ Продано ❌\n\n' + POST_1666.replace('#АКТУАЛЬНО_RaXi\n', ''));
    expect(p.status).toBe('sold');
    expect(p.nuances).toEqual(['Следы от чехла по бокам']);
    expect(isListingPost('❌ Продано ❌')).toBe(false);
  });
});

describe('parseModel', () => {
  it.each([
    ['iPhone 16 Pro 512GB', '16 Pro'],
    ['iPhone 16e 128GB', '16e'],
    ['iPhone SE 64GB', 'SE'],
    ['iPhone XR 128GB', 'XR'],
    ['iPhone 13 mini', '13 mini'],
    ['iPhone 17 Air 256GB', '17 Air'],
    ['iPhone 15 Plus', '15 Plus'],
    ['iphone 14 pro max', '14 Pro Max'],
  ])('%s → %s', (line, family) => {
    expect(parseModel(line)?.family).toBe(family);
  });

  it('1TB → 1024', () => {
    expect(parsePost('📱 iPhone 15 Pro Max 1TB\n💰 90 000 ₽').storage_gb).toBe(1024);
  });

  it('eSIM-only → нет физической SIM', () => {
    expect(parsePost('📱 iPhone 17 Pro 256GB\neSIM\n💰 1 ₽').has_physical_sim).toBe(false);
  });
});

describe('реальные посты канала', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .flatMap((f) => parseFeed(readFileSync(new URL(f, dir), 'utf8'), 'apple_raxi'))
    .filter((p) => /📱/.test(p.text));

  it('в фикстурах есть посты', () => {
    expect(posts.length).toBeGreaterThanOrEqual(10);
  });

  it.each(posts.map((p) => [p.msg_id, p] as const))('пост %i разобран', (_, post) => {
    const p = parsePost(post.text);
    expect(p.parse_ok).toBe(true);
    expect(p.battery_pct).toBeGreaterThan(50);
    expect(p.condition).toBeTruthy();
    expect(post.media.length).toBeGreaterThan(0);
    expect(p.status).toBe(post.text.includes('#АКТУАЛЬНО_RaXi') ? 'active' : 'sold');
  });
});
