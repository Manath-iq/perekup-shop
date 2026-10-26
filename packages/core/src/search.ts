import { matchModel, type Category } from './catalog';
import { formatPrice, formatStorage } from './format';

/**
 * Умный поиск: «15 про 256 до 60к акб 90» → модель, память, потолок цены, АКБ.
 * Тот же словарь, что и у разбора постов, поэтому сленг покупателя и продавца понимается одинаково.
 */
export interface SearchQuery {
  model?: { id: string; title: string; short: string; line: string; category: Category };
  /** Только линейка или бренд, без конкретной модели: «айфон», «самсунг», «макбук» */
  line?: string;
  brand?: string;
  storage_gb?: number;
  /** Процессор Mac или iPad: «M2», «M3 Pro» */
  chip?: string;
  price_min?: number;
  price_max?: number;
  battery_min?: number;
  physical_sim?: boolean;
  full_kit?: boolean;
  /** Что осталось нераспознанным — ищется по тексту заголовка */
  text?: string;
}

export interface SearchChip {
  key: keyof SearchQuery;
  label: string;
}

const STORAGES = new Set([32, 64, 128, 256, 512, 1024, 2048]);

const LINES: [RegExp, { line?: string; brand: string }][] = [
  [/(?<![\p{L}])(айфон\p{L}*|iphone)(?![\p{L}])/iu, { line: 'iPhone', brand: 'apple' }],
  [/(?<![\p{L}])(айпад\p{L}*|ipad)(?![\p{L}])/iu, { line: 'iPad', brand: 'apple' }],
  [/(?<![\p{L}])(макбук\p{L}*|macbook)(?![\p{L}])/iu, { line: 'MacBook', brand: 'apple' }],
  [/(?<![\p{L}])(эйрподс\p{L}*|аирподс\p{L}*|airpods)(?![\p{L}])/iu, { line: 'AirPods', brand: 'apple' }],
  [/(?<![\p{L}])(самсунг\p{L}*|samsung|galaxy|гэлакси)(?![\p{L}])/iu, { brand: 'samsung' }],
  [/(?<![\p{L}])(сяоми|xiaomi|redmi|редми|poco|поко)(?![\p{L}])/iu, { brand: 'xiaomi' }],
  [/(?<![\p{L}])(пиксель|pixel)(?![\p{L}])/iu, { brand: 'google' }],
];

/** «60к», «60 000», «60.000», «60 тыс» → 60000 */
function money(num: string, suffix?: string): number | null {
  const clean = num.replace(/\s/g, '');
  let n = suffix ? parseFloat(clean.replace(',', '.')) * 1000 : parseInt(clean.replace(/[.,]/g, ''), 10);
  if (!suffix && n < 1000) n *= 1000; // «до 60» в контексте цены — тысячи
  return Number.isFinite(n) && n >= 1000 ? Math.round(n) : null;
}

const PRICE = '(\\d{1,3}(?:[ .,]\\d{3})+|\\d{1,7}(?:[.,]\\d)?)\\s*(к|k|тыс\\.?|т\\.?р\\.?)?\\s*(?:₽|р\\.?|руб\\p{L}*)?';

export function parseQuery(input: string, opts: { defaultBrand?: string } = {}): SearchQuery {
  let s = ` ${input.toLowerCase().replace(/ /g, ' ')} `;
  const q: SearchQuery = {};
  const cut = (re: RegExp) => (s = s.replace(re, ' '));

  // цена: «до 60к», «дешевле 60 000», «от 40к», «40-60к»
  const range = s.match(new RegExp(`(\\d{1,3})\\s*[-–]\\s*${PRICE}`, 'iu'));
  if (range && (range[3] || +range[1] < +range[2])) {
    const max = money(range[2], range[3]);
    const min = max ? money(range[1], range[3] || 'к') : null;
    if (min && max && min < max) ((q.price_min = min), (q.price_max = max), (s = s.replace(range[0], ' ')));
  }
  const max = s.match(new RegExp(`(?:до|дешевле|не дороже|макс\\p{L}*|<)\\s*${PRICE}`, 'iu'));
  if (max) {
    const v = money(max[1], max[2]);
    if (v) ((q.price_max = v), (s = s.replace(max[0], ' ')));
  }
  const min = s.match(new RegExp(`(?:от|дороже|>)\\s*${PRICE}(?!\\s*%)`, 'iu'));
  if (min && !/акб|батар|%/.test(s.slice(Math.max(0, (min.index ?? 0) - 6), min.index))) {
    const v = money(min[1], min[2]);
    if (v && (!q.price_max || v < q.price_max)) ((q.price_min = v), (s = s.replace(min[0], ' ')));
  }

  // АКБ: «акб 90», «акб от 90», «90%»
  const bat = s.match(/(?:акб|акк\p{L}*|батаре\p{L}*|battery)\s*(?:от\s*)?(\d{2,3})\s*%?|(?<![\d])(\d{2,3})\s*%/iu);
  if (bat) {
    const v = +(bat[1] ?? bat[2]);
    if (v >= 50 && v <= 100) ((q.battery_min = v), (s = s.replace(bat[0], ' ')));
  }

  // процессор: «м2», «m3 pro»
  const chip = s.match(/(?<![\p{L}\d])[мm]([1-5])(?:\s*(pro|про|max|макс))?(?![\p{L}\d])/iu);
  if (chip) {
    q.chip = `M${chip[1]}${chip[2] ? (/^(pro|про)$/i.test(chip[2]) ? ' Pro' : ' Max') : ''}`;
    s = s.replace(chip[0], ' ');
  }

  // модель — по словарю, «голый» айфон — только с брендом магазина по умолчанию
  const m = matchModel(s, opts);
  // «макбук» без Air или Pro — это линейка, а не модель
  if (m && m.id === 'macbook') {
    q.line = 'MacBook';
    q.brand = 'apple';
    s = s.slice(0, m.index) + ' ' + s.slice(m.end);
  } else if (m) {
    q.model = { id: m.id, title: m.title, short: m.short, line: m.line, category: m.category };
    s = s.slice(0, m.index) + ' ' + s.slice(m.end);
  }

  // память: «256», «256гб», «1тб»
  const st = s.match(/(?<![\d.,])(\d{1,4})\s*(гб|gb|тб|tb|т)?(?![\p{L}\d])/iu);
  if (st) {
    const gb = st[2] && /т|t/i.test(st[2]) ? +st[1] * 1024 : +st[1];
    if (STORAGES.has(gb)) ((q.storage_gb = gb), (s = s.replace(st[0], ' ')));
  }

  if (/(?<![\p{L}])(физ\p{L}*\s*сим|сим[\s-]*карт\p{L}*|nano\s*sim|2\s*sim|две\s*сим)/iu.test(s)) {
    q.physical_sim = true;
    cut(/(?<![\p{L}])(физ\p{L}*\s*сим\p{L}*|сим[\s-]*карт\p{L}*|nano\s*sim|2\s*sim|две\s*сим\p{L}*)/giu);
  }
  if (/полн\p{L}*(\s*компл\p{L}*)?/iu.test(s)) {
    q.full_kit = true;
    cut(/полн\p{L}*(\s*компл\p{L}*)?/giu);
  }

  if (!q.model) {
    for (const [re, v] of LINES) {
      if (!re.test(s)) continue;
      q.brand = v.brand;
      if (v.line) q.line = v.line;
      cut(new RegExp(re.source, 'giu'));
      break;
    }
  } else {
    for (const [re] of LINES) cut(new RegExp(re.source, 'giu'));
  }

  const text = s.replace(/[^\p{L}\d+ ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (text.length >= 2) q.text = text;
  return q;
}

export function queryChips(q: SearchQuery): SearchChip[] {
  const chips: SearchChip[] = [];
  if (q.model) chips.push({ key: 'model', label: q.model.title });
  else if (q.line) chips.push({ key: 'line', label: q.line });
  else if (q.brand) chips.push({ key: 'brand', label: q.brand === 'apple' ? 'Apple' : q.brand[0].toUpperCase() + q.brand.slice(1) });
  if (q.storage_gb) chips.push({ key: 'storage_gb', label: formatStorage(q.storage_gb).replace('GB', ' ГБ').replace('TB', ' ТБ') });
  if (q.price_min && q.price_max) chips.push({ key: 'price_max', label: `${formatPrice(q.price_min).replace(' ₽', '')}–${formatPrice(q.price_max)}` });
  else if (q.price_max) chips.push({ key: 'price_max', label: `до ${formatPrice(q.price_max)}` });
  else if (q.price_min) chips.push({ key: 'price_min', label: `от ${formatPrice(q.price_min)}` });
  if (q.chip) chips.push({ key: 'chip', label: q.chip });
  if (q.battery_min) chips.push({ key: 'battery_min', label: `АКБ от ${q.battery_min}%` });
  if (q.physical_sim) chips.push({ key: 'physical_sim', label: 'Физическая SIM' });
  if (q.full_kit) chips.push({ key: 'full_kit', label: 'Полный комплект' });
  if (q.text) chips.push({ key: 'text', label: `«${q.text}»` });
  return chips;
}

export function withoutChip(q: SearchQuery, key: keyof SearchQuery): SearchQuery {
  const next = { ...q };
  delete next[key];
  if (key === 'price_max') delete next.price_min;
  return next;
}

/** Есть ли что искать: пустой запрос показывает обычную витрину */
export const isEmptyQuery = (q: SearchQuery) => Object.keys(q).length === 0;

export interface Searchable {
  model_id: string | null;
  line: string | null;
  brand: string | null;
  title: string;
  price: number | null;
  attrs: { storage_gb?: number; battery_pct?: number; physical_sim?: boolean; full_kit?: boolean; chip?: string };
}

export function matchesQuery(l: Searchable, q: SearchQuery): boolean {
  if (q.model && l.model_id !== q.model.id) return false;
  if (q.line && !(l.line ?? '').startsWith(q.line)) return false;
  if (q.brand && l.brand !== q.brand) return false;
  if (q.storage_gb && l.attrs.storage_gb !== q.storage_gb) return false;
  if (q.chip && !(l.attrs.chip ?? '').startsWith(q.chip)) return false;
  if (q.price_max && (l.price ?? Infinity) > q.price_max) return false;
  if (q.price_min && (l.price ?? 0) < q.price_min) return false;
  if (q.battery_min && (l.attrs.battery_pct ?? 0) < q.battery_min) return false;
  if (q.physical_sim && !l.attrs.physical_sim) return false;
  if (q.full_kit && !l.attrs.full_kit) return false;
  if (q.text && !q.text.split(' ').every((w) => l.title.toLowerCase().includes(w))) return false;
  return true;
}

/**
 * Ближайшее из наличия, когда точного совпадения нет: та же модель с другой памятью или ценой,
 * иначе та же линейка; объясняем, чем отличается.
 */
export function nearest<T extends Searchable>(items: T[], q: SearchQuery): { item: T; diff: string } | null {
  const pool = q.model ? items.filter((l) => l.model_id === q.model!.id) : q.line ? items.filter((l) => (l.line ?? '').startsWith(q.line!)) : [];
  const ranked = (pool.length ? pool : q.model ? items.filter((l) => l.line === q.model!.line) : [])
    .map((item) => {
      const diffs: string[] = [];
      if (q.model && item.model_id !== q.model.id) diffs.push(item.title.replace(`${q.model.line} `, ''));
      if (q.storage_gb && item.attrs.storage_gb && item.attrs.storage_gb !== q.storage_gb) diffs.push(`${item.attrs.storage_gb} вместо ${q.storage_gb}`);
      if (q.price_max && item.price && item.price > q.price_max) diffs.push(`дороже на ${formatPrice(item.price - q.price_max)}`);
      if (q.battery_min && (item.attrs.battery_pct ?? 0) < q.battery_min) diffs.push(`АКБ ${item.attrs.battery_pct ?? '?'}%`);
      return { item, diff: diffs.join(', '), score: diffs.length * 1e7 + Math.abs((item.price ?? 0) - (q.price_max ?? item.price ?? 0)) };
    })
    .sort((a, b) => a.score - b.score);
  return ranked[0] ? { item: ranked[0].item, diff: ranked[0].diff } : null;
}
