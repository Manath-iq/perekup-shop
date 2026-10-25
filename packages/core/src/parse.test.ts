import { describe, expect, it } from 'vitest';
import { matchModel } from './catalog';
import { parsePost } from './parse';
import { mergeLlm } from './llm';

describe('словарь моделей', () => {
  it.each([
    ['iPhone 16 Pro 512GB', 'iphone-16-pro', '16 Pro'],
    ['iPhone 16e 128GB', 'iphone-16e', '16e'],
    ['iPhone SE 64GB', 'iphone-se', 'SE'],
    ['iPhone SE 2022 128', 'iphone-se-2022', 'SE 2022'],
    ['iPhone XR 128GB', 'iphone-xr', 'XR'],
    ['iPhone XS Max', 'iphone-xs-max', 'XS Max'],
    ['iPhone 13 mini', 'iphone-13-mini', '13 mini'],
    ['iPhone 17 Air 256GB', 'iphone-17-air', '17 Air'],
    ['iPhone 15 Plus', 'iphone-15-plus', '15 Plus'],
    ['iphone 14 pro max', 'iphone-14-pro-max', '14 Pro Max'],
    ['Айфон 15 про макс', 'iphone-15-pro-max', '15 Pro Max'],
    ['айфон 13 мини', 'iphone-13-mini', '13 mini'],
    ['iPhone 12 PM', 'iphone-12-pro-max', '12 Pro Max'],
    ['Samsung Galaxy S24 Ultra 512', 'galaxy-s24-ultra', 'S24 Ultra'],
    ['S23+ 256гб', 'galaxy-s23-plus', 'S23 Plus'],
    ['Galaxy Z Fold5', 'galaxy-z-fold5', 'Z Fold5'],
    ['Самсунг А54', 'galaxy-a54', 'A54'],
    ['самсунг с24 ультра', 'galaxy-s24-ultra', 'S24 Ultra'],
    ['А54 128', null, null],
    ['Samsung A54 128', 'galaxy-a54', 'A54'],
    ['Google Pixel 8 Pro', 'pixel-8-pro', '8 Pro'],
    ['Pixel 8a', 'pixel-8a', '8a'],
    ['Redmi Note 13 Pro+', 'redmi-note-13-pro-plus', 'Note 13 Pro+'],
    ['Xiaomi 14 Ultra', 'xiaomi-14-ultra', '14 Ultra'],
    ['POCO F6 Pro', 'poco-f6-pro', 'F6 Pro'],
    ['MacBook Air M2 13"', 'macbook-air', ''],
    ['Макбук про 14 M3 Pro', 'macbook-pro', ''],
    ['iPad Pro 11 M4', 'ipad-pro', 'Pro'],
    ['iPad 10', 'ipad', ''],
    ['Apple Watch Ultra 2 49mm', 'apple-watch-ultra-2', 'Ultra 2'],
    ['Apple Watch Series 9 45mm', 'apple-watch-series-9', 'Series 9'],
    ['Watch S10 46', 'apple-watch-series-10', 'Series 10'],
    ['Galaxy Watch 6 Classic', 'galaxy-watch-6-classic', '6 Classic'],
    ['AirPods Pro 2', 'airpods-pro-2', 'Pro 2'],
    ['AirPods Max', 'airpods-max', 'Max'],
    ['Аирподс 4', 'airpods-4', '4'],
    ['PS5 Slim', 'playstation-5-slim', '5 Slim'],
    ['Sony PlayStation 5 Pro', 'playstation-5-pro', '5 Pro'],
    ['Xbox Series X', 'xbox-series-x', 'Series X'],
    ['Nintendo Switch OLED', 'nintendo-switch-oled', 'OLED'],
    ['Steam Deck OLED 512', 'steam-deck-oled', 'OLED'],
  ])('%s', (text, id, short) => {
    const m = matchModel(text);
    expect(m?.id ?? null).toBe(id);
    if (short !== null) expect(m?.short).toBe(short);
  });

  it('«голый» айфон — только с брендом по умолчанию', () => {
    expect(matchModel('15 Pro Max 256')).toBeNull();
    expect(matchModel('15 Pro Max 256', { defaultBrand: 'apple' })?.id).toBe('iphone-15-pro-max');
    expect(matchModel('13 128гб', { defaultBrand: 'apple' })?.id).toBe('iphone-13');
    expect(matchModel('Цена 15 000', { defaultBrand: 'apple' })).toBeNull();
  });
});

describe('разбор постов в разных шаблонах', () => {
  it('короткий пост со сленгом', () => {
    const p = parsePost('Айфон 15 про макс 256 гб\nакб 87%\nсостояние идеал\nцена 79.990р');
    expect(p.model?.id).toBe('iphone-15-pro-max');
    expect(p.price).toBe(79990);
    expect(p.attrs).toMatchObject({ storage_gb: 256, battery_pct: 87 });
    expect(p.status).toBe('active');
    expect(p.parse_ok).toBe(true);
  });

  it('цена в тысячах и «было/стало»', () => {
    const p = parsePost('iPhone 14 128\nБыло 52 000\nСейчас 48к');
    expect(p.price).toBe(48000);
    expect(p.old_price).toBe(52000);
    expect(p.attrs.storage_gb).toBe(128);
  });

  it('цена с ₽ без метки, циклы и АКБ перед словом', () => {
    const p = parsePost('📱 Samsung Galaxy S24 Ultra 12/512GB Titanium Black\n100% акб, 45 циклов\n94 990 ₽');
    expect(p.model?.id).toBe('galaxy-s24-ultra');
    expect(p.attrs).toMatchObject({ storage_gb: 512, battery_pct: 100, battery_cycles: 45, color: 'Чёрный титан' });
    expect(p.price).toBe(94990);
  });

  it('ноутбук: чип, RAM/SSD, экран, циклы', () => {
    const p = parsePost('MacBook Pro 14 M3 Pro 18/512\nЦиклов: 31, АКБ 98%\nКомплект: коробка, зарядка\n💰 145 000 ₽');
    expect(p.category).toBe('computer');
    expect(p.model?.title).toBe('MacBook Pro');
    expect(p.attrs).toMatchObject({ chip: 'M3 Pro', ram_gb: 18, storage_gb: 512, screen_in: 14, battery_pct: 98 });
    expect(p.parse_ok).toBe(true);
  });

  it('наушники: оригинал или реплика', () => {
    expect(parsePost('AirPods Pro 2 оригинал\n15 000 ₽').attrs.original).toBe(true);
    expect(parsePost('AirPods Pro 2 люкс копия\n2 500 ₽').attrs.original).toBe(false);
  });

  it('«Состояние АКБ» не путается с состоянием', () => {
    const p = parsePost('iPhone 13 256GB\nСостояние АКБ: 86%\n40 000 ₽');
    expect(p.attrs.battery_pct).toBe(86);
    expect(p.attrs.condition).toBeUndefined();
  });

  it('статусы: продано, бронь, не объявление', () => {
    expect(parsePost('iPhone 13 256GB\n40 000 ₽\nПРОДАНО').status).toBe('sold');
    expect(parsePost('iPhone 13 256GB\n40 000 ₽\n🔒 Бронь до вечера').status).toBe('reserved');
    expect(parsePost('Всем привет! Сегодня работаем до 20:00').status).toBe('not_listing');
    expect(parsePost('#отзыв Купил iPhone 13, всё отлично', { ignoreMarkers: ['#отзыв'] }).status).toBe('not_listing');
  });

  it('режим active_marker: без метки — sold', () => {
    const profile = { mode: 'active_marker' as const, activeMarkers: ['#вналичии'] };
    expect(parsePost('iPhone 13 256GB\n40 000 ₽\n#вналичии', profile).status).toBe('active');
    expect(parsePost('iPhone 13 256GB\n40 000 ₽', profile)).toMatchObject({ status: 'sold', status_source: 'inferred' });
  });

  it('метка-регулярка в профиле', () => {
    const p = parsePost('iPhone 13 256GB\n40 000 ₽\nSOLD OUT', { soldMarkers: ['/sold\\s*out/i'] });
    expect(p.status).toBe('sold');
  });

  it('неуверенный разбор: нет модели', () => {
    const p = parsePost('Телефон в отличном состоянии\nЦена 25 000');
    expect(p.parse_ok).toBe(false);
    expect(p.missing).toContain('model');
    expect(p.title).toBe('Телефон в отличном состоянии');
  });
});

describe('слияние с ответом LLM', () => {
  it('дополняет пропуски и требует подтверждения', () => {
    const base = parsePost('Телефон Сяоми, 256 памяти\nотдам за 18 тысяч');
    const merged = mergeLlm(base, {
      is_listing: true,
      status: 'active',
      category: 'phone',
      model: 'Xiaomi 13T Pro',
      price_rub: 18000,
      storage_gb: 256,
    });
    expect(merged.model?.id).toBe('xiaomi-13t-pro');
    expect(merged.price).toBe(18000);
    expect(merged.attrs.storage_gb).toBe(256);
    expect(merged.missing).toEqual([]);
    expect(merged.parse_ok).toBe(false);
  });
});
