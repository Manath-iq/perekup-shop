import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePost } from '@vitrina/core/parse';
import { parseFeed } from '@vitrina/core/scrape';
import profile from './profile.json';

/** Регрессия: посты, на которых собирался прототип, разбираются не хуже, чем раньше */
const parse = (text: string) => parsePost(text, profile as never);

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

describe('RaXi — примеры из ТЗ', () => {
  it('пост 1666', () => {
    const p = parse(POST_1666);
    expect(p).toMatchObject({ category: 'phone', status: 'active', status_source: 'marker', price: 43990, parse_ok: true });
    expect(p.model).toMatchObject({ id: 'iphone-16', short: '16', title: 'iPhone 16' });
    expect(p.attrs).toEqual({
      storage_gb: 128,
      battery_pct: 88,
      sim: 'SIM + eSIM',
      physical_sim: true,
      condition: 'Отличное',
      kit: 'Полный комплект',
      full_kit: true,
    });
    expect(p.pluses).not.toContain('Акб 88%');
    expect(p.pluses).toContain('Оригинальный провод');
    expect(p.nuances).toEqual(['Следы от чехла по бокам']);
  });

  it('пост 1672', () => {
    const p = parse(POST_1672);
    expect(p.model?.short).toBe('15 Pro Max');
    expect(p).toMatchObject({ price: 49990, parse_ok: true });
    expect(p.attrs).toMatchObject({
      storage_gb: 256,
      condition: 'Идеал',
      battery_pct: 85,
      os_version: '18.4',
      kit: 'телефон, блок, провод',
      full_kit: false,
    });
    expect(p.pluses.some((s) => /ios/i.test(s))).toBe(false);
    expect(p.nuances).toEqual(['Комплект: телефон, блок, провод']);
  });

  it('проданный пост без хэштега → sold', () => {
    const p = parse('❌ Продано ❌\n\n' + POST_1666.replace('#АКТУАЛЬНО_RaXi\n', ''));
    expect(p.status).toBe('sold');
    expect(p.status_source).toBe('marker');
    expect(p.nuances).toEqual(['Следы от чехла по бокам']);
    expect(parse('❌ Продано ❌').status).toBe('not_listing');
  });

  it('1TB → 1024', () => {
    expect(parse('📱 iPhone 15 Pro Max 1TB\n💰 90 000 ₽').attrs.storage_gb).toBe(1024);
  });

  it('eSIM-only → нет физической SIM', () => {
    expect(parse('📱 iPhone 17 Pro 256GB\neSIM\n💰 1 000 ₽').attrs.physical_sim).toBe(false);
  });
});

describe('RaXi — реальные посты канала', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .flatMap((f) => parseFeed(readFileSync(new URL(f, dir), 'utf8'), 'apple_raxi'))
    .filter((p) => /📱/.test(p.text));

  it('в фикстурах есть посты', () => {
    expect(posts.length).toBeGreaterThanOrEqual(10);
  });

  it.each(posts.map((p) => [p.msg_id, p] as const))('пост %i разобран', (_, post) => {
    const p = parse(post.text);
    expect(p.parse_ok).toBe(true);
    expect(p.attrs.battery_pct).toBeGreaterThan(50);
    expect(p.attrs.condition).toBeTruthy();
    expect(post.media.length).toBeGreaterThan(0);
    expect(p.status).toBe(post.text.includes('#АКТУАЛЬНО_RaXi') ? 'active' : 'sold');
  });
});
