/**
 * Категории товаров и словарь моделей.
 * Словарь общий для разбора постов, умного поиска и подписок: «15 про макс», «15pm» и «iPhone 15 Pro Max»
 * сводятся к одной модели `iphone-15-pro-max`.
 */

export type Category = 'phone' | 'tablet' | 'computer' | 'watch' | 'audio' | 'console' | 'other';

/** Характеристики товара. Набор зависит от категории, лишние поля просто не заполняются. */
export interface Attrs {
  storage_gb?: number;
  ram_gb?: number;
  battery_pct?: number;
  battery_cycles?: number;
  sim?: string;
  physical_sim?: boolean;
  os_version?: string;
  chip?: string;
  screen_in?: number;
  case_mm?: number;
  color?: string;
  original?: boolean;
  condition?: string;
  kit?: string;
  full_kit?: boolean;
}

export type AttrKey = keyof Attrs;

export interface CategoryDef {
  id: Category;
  title: string;
  /** Что показываем в карточке и фильтрах, по порядку */
  attrs: AttrKey[];
  /** Без этих полей разбор считается неуверенным */
  required: AttrKey[];
}

export const CATEGORIES: Record<Category, CategoryDef> = {
  phone: {
    id: 'phone',
    title: 'Телефоны',
    attrs: ['storage_gb', 'battery_pct', 'battery_cycles', 'sim', 'os_version', 'color', 'condition', 'kit'],
    required: ['storage_gb'],
  },
  tablet: {
    id: 'tablet',
    title: 'Планшеты',
    attrs: ['storage_gb', 'chip', 'screen_in', 'battery_pct', 'sim', 'color', 'condition', 'kit'],
    required: ['storage_gb'],
  },
  computer: {
    id: 'computer',
    title: 'Компьютеры',
    attrs: ['chip', 'ram_gb', 'storage_gb', 'screen_in', 'battery_pct', 'battery_cycles', 'color', 'condition', 'kit'],
    required: [],
  },
  watch: {
    id: 'watch',
    title: 'Часы',
    attrs: ['case_mm', 'battery_pct', 'color', 'original', 'condition', 'kit'],
    required: [],
  },
  audio: {
    id: 'audio',
    title: 'Наушники',
    attrs: ['original', 'battery_pct', 'condition', 'kit'],
    required: [],
  },
  console: {
    id: 'console',
    title: 'Приставки',
    attrs: ['storage_gb', 'color', 'condition', 'kit'],
    required: [],
  },
  other: { id: 'other', title: 'Другое', attrs: ['condition', 'kit'], required: [] },
};

export const ATTR_LABELS: Record<AttrKey, string> = {
  storage_gb: 'Память',
  ram_gb: 'Оперативная память',
  battery_pct: 'Аккумулятор',
  battery_cycles: 'Циклы зарядки',
  sim: 'SIM',
  physical_sim: 'Физическая SIM',
  os_version: 'Версия ОС',
  chip: 'Процессор',
  screen_in: 'Экран',
  case_mm: 'Корпус',
  color: 'Цвет',
  original: 'Оригинал',
  condition: 'Состояние',
  kit: 'Комплект',
  full_kit: 'Полный комплект',
};

export interface ModelMatch {
  /** Канонический id: `iphone-15-pro-max`, `galaxy-s24-ultra` */
  id: string;
  brand: string;
  category: Category;
  /** Линейка для полосы моделей: «iPhone», «Galaxy», «MacBook Air» */
  line: string;
  /** Короткое имя внутри линейки: «15 Pro Max» */
  short: string;
  /** Полное имя для карточки: «iPhone 15 Pro Max» */
  title: string;
  /** Как было написано в посте */
  raw: string;
  /** Где нашлось в строке — нужно, чтобы искать память сразу после модели */
  index: number;
  end: number;
}

// \b в JS не знает кириллицу, поэтому границы слова — через Unicode-классы
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\+/g, '-plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Вариант модели со сленгом → каноническое написание */
const VARIANTS: [RegExp, string][] = [
  [/^(pro\s*max|про\s*макс|promax|pm|п\s*м)$/i, 'Pro Max'],
  [/^(pro\s*xl)$/i, 'Pro XL'],
  [/^(pro\s*fold)$/i, 'Pro Fold'],
  [/^(pro|про)$/i, 'Pro'],
  [/^(plus|плюс|\+)$/i, 'Plus'],
  [/^(mini|мини)$/i, 'mini'],
  [/^(air|эйр)$/i, 'Air'],
  [/^(max|макс)$/i, 'Max'],
  [/^(ultra|ультра)$/i, 'Ultra'],
  [/^(slim|слим)$/i, 'Slim'],
  [/^(digital|диджитал)$/i, 'Digital'],
  [/^(oled|олед)$/i, 'OLED'],
  [/^(lite|лайт)$/i, 'Lite'],
  [/^fe$/i, 'FE'],
  [/^edge$/i, 'Edge'],
  [/^xl$/i, 'XL'],
  [/^a$/i, 'a'],
  [/^fold$/i, 'Fold'],
];

export function normalizeVariant(v: string | undefined): string {
  if (!v) return '';
  const t = ws(v);
  for (const [re, out] of VARIANTS) if (re.test(t)) return out;
  return t;
}

const V_IPHONE = 'pro\\s*max|про\\s*макс|promax|pm|pro|про|plus|плюс|\\+|mini|мини|air|эйр|max|макс';

interface Matcher {
  re: RegExp;
  build(m: RegExpExecArray): Omit<ModelMatch, 'raw' | 'index' | 'end'> | null;
}

const mk = (brand: string, category: Category, line: string, short: string, idPrefix = line) => {
  const s = ws(short);
  return { id: slug(`${idPrefix} ${s}`), brand, category, line, short: s, title: ws(`${line} ${s}`) };
};

function iphoneNumber(n: string): string {
  const up = n.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^\d+E$/.test(up)) return up.replace('E', 'e');
  const se = up.match(/^SE\s*(?:20)?(\d+)?$/);
  if (se) {
    const g = se[1];
    if (!g) return 'SE';
    if (g === '2' || g === '20') return 'SE 2020';
    if (g === '3' || g === '22') return 'SE 2022';
    return 'SE';
  }
  return up;
}

/** Порядок важен: сначала более специфичные (Galaxy Watch раньше Apple Watch, iPad раньше «голого» iPhone) */
const MATCHERS: Matcher[] = [
  // ——— Samsung: часы, планшеты, наушники, телефоны ———
  {
    re: new RegExp(`${B}(?:samsung\\s*|самсунг\\s*)?(?:galaxy|гэлакси)\\s*watch\\s*(\\d{1,2}|ultra)?(?:\\s*(classic|pro))?${E}`, 'iu'),
    build: (m) => mk('samsung', 'watch', 'Galaxy Watch', [m[1], m[2]].filter(Boolean).map((x) => normalizeVariant(x)).join(' ')),
  },
  {
    re: new RegExp(`${B}(?:samsung\\s*|самсунг\\s*)?(?:galaxy\\s*)?tab\\s*(s\\d{1,2}|a\\d?)?\\s*(ultra|ультра|plus|\\+|fe)?${E}`, 'iu'),
    build: (m) => mk('samsung', 'tablet', 'Galaxy Tab', [m[1]?.toUpperCase(), normalizeVariant(m[2])].filter(Boolean).join(' ')),
  },
  {
    re: new RegExp(`${B}(?:samsung\\s*|самсунг\\s*)?(?:galaxy\\s*)?buds\\s*(\\d|fe|pro|live)?\\s*(pro)?${E}`, 'iu'),
    build: (m) => mk('samsung', 'audio', 'Galaxy Buds', [m[1], m[2]].filter(Boolean).map((x) => normalizeVariant(x)).join(' ')),
  },
  {
    re: new RegExp(`${B}(?:samsung\\s*|самсунг\\s*)?(?:galaxy\\s*)?z?\\s*(fold|flip)\\s*(\\d)(?:\\s*(fe))?${E}`, 'iu'),
    build: (m) => mk('samsung', 'phone', 'Galaxy', `Z ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}${m[2]}${m[3] ? ' FE' : ''}`),
  },
  {
    re: new RegExp(`${B}(?:samsung\\s*|самсунг\\s*)?(?:galaxy\\s*)?[sс]\\s?(2\\d|1\\d)(?:\\s*(ultra|ультра|plus|плюс|\\+|fe|edge))?${E}`, 'iu'),
    build: (m) => mk('samsung', 'phone', 'Galaxy', `S${m[1]}${m[2] ? ' ' + normalizeVariant(m[2]) : ''}`),
  },
  {
    re: new RegExp(`${B}(?:samsung|самсунг|galaxy)\\s*(?:galaxy\\s*)?([aа]\\d{2}|m\\d{2}|note\\s*\\d{1,2})(?:\\s*(ultra|plus|\\+|fe|5g))?${E}`, 'iu'),
    build: (m) => {
      const base = m[1].replace(/\s+/g, ' ');
      // кириллическая «а» в «а54» — та же модель
      const short = /^note/i.test(base) ? `Note ${base.replace(/\D/g, '')}` : base.replace(/^а/i, 'A').toUpperCase();
      return mk('samsung', 'phone', 'Galaxy', `${short}${m[2] && !/5g/i.test(m[2]) ? ' ' + normalizeVariant(m[2]) : ''}`);
    },
  },

  // ——— Apple ———
  {
    re: new RegExp(`${B}(?:apple\\s*)?(?:ipad|айпад)\\s*(pro|про|air|эйр|mini|мини)?${E}`, 'iu'),
    build: (m) => mk('apple', 'tablet', 'iPad', normalizeVariant(m[1])),
  },
  {
    re: new RegExp(`${B}(?:apple\\s*)?(?:macbook|макбук)\\s*(air|эйр|pro|про)?${E}`, 'iu'),
    build: (m) => {
      const v = normalizeVariant(m[1]);
      return { ...mk('apple', 'computer', v ? `MacBook ${v}` : 'MacBook', ''), id: slug(`macbook ${v}`) };
    },
  },
  {
    re: new RegExp(`${B}(?:apple\\s*)?(imac|mac\\s*mini|mac\\s*studio|mac\\s*pro)${E}`, 'iu'),
    build: (m) => {
      const name = /imac/i.test(m[1]) ? 'iMac' : `Mac ${m[1].replace(/mac\s*/i, '').replace(/^\w/, (c) => c.toUpperCase())}`;
      return { ...mk('apple', 'computer', name, ''), id: slug(name) };
    },
  },
  {
    re: new RegExp(
      `${B}(?:apple\\s*watch|эпл\\s*вотч|эппл\\s*вотч|watch|вотч|aw)\\s*(ultra\\s*\\d?|ультра\\s*\\d?|series\\s*\\d{1,2}|s\\s?\\d{1,2}|se\\s*\\d?)${E}`,
      'iu',
    ),
    build: (m) => {
      const v = ws(m[1]).toLowerCase();
      let short: string;
      if (/^(ultra|ультра)/.test(v)) short = `Ultra${v.match(/\d/) ? ' ' + v.match(/\d/)![0] : ''}`;
      else if (/^se(?![a-z])/.test(v)) short = `SE${v.match(/\d/) ? ' ' + v.match(/\d/)![0] : ''}`;
      else short = `Series ${v.replace(/\D/g, '')}`;
      return mk('apple', 'watch', 'Apple Watch', short);
    },
  },
  {
    re: new RegExp(`${B}(?:apple\\s*)?(?:airpods|эйрподс|аирподс|эирподс)\\s*(pro\\s*\\d?|про\\s*\\d?|max|макс|\\d)?${E}`, 'iu'),
    build: (m) => {
      const v = m[1] ? ws(m[1]) : '';
      const num = v.match(/\d/)?.[0];
      const base = /^(pro|про)/i.test(v) ? 'Pro' : /^(max|макс)/i.test(v) ? 'Max' : '';
      return mk('apple', 'audio', 'AirPods', [base, num].filter(Boolean).join(' '));
    },
  },
  {
    re: new RegExp(`${B}(?:apple\\s*)?(?:iphone|айфон|iph)\\s*(1[1-9]e?|se(?:\\s*(?:20)?(?:20|22|2|3))?|xs|xr|x)(?:\\s*(${V_IPHONE}))?(?![\\p{L}\\d])`, 'iu'),
    build: (m) => {
      const num = iphoneNumber(m[1]);
      const variant = normalizeVariant(m[2]);
      return mk('apple', 'phone', 'iPhone', [num, variant].filter(Boolean).join(' '));
    },
  },

  // ——— Google, Xiaomi ———
  {
    re: new RegExp(`${B}(?:google\\s*)?(?:pixel|пиксель)\\s*(\\d{1,2})(?:\\s*(pro\\s*xl|pro\\s*fold|pro|xl|a|fold))?${E}`, 'iu'),
    build: (m) => mk('google', 'phone', 'Pixel', `${m[1]}${m[2] ? (/^a$/i.test(m[2]) ? 'a' : ' ' + normalizeVariant(m[2])) : ''}`),
  },
  {
    re: new RegExp(`${B}(?:xiaomi\\s*)?(?:redmi|редми)\\s*(note\\s*\\d{1,2}|\\d{1,2}[a-z]?)(?:\\s*(pro\\s*\\+|pro\\+|pro|s|5g))?${E}`, 'iu'),
    build: (m) => {
      const base = /note/i.test(m[1]) ? `Note ${m[1].replace(/\D/g, '')}` : m[1].toUpperCase();
      const v = m[2] && !/5g/i.test(m[2]) ? ' ' + (m[2].replace(/\s+/g, '').replace(/pro/i, 'Pro')) : '';
      return mk('xiaomi', 'phone', 'Redmi', base + v);
    },
  },
  {
    re: new RegExp(`${B}(?:xiaomi\\s*)?(?:poco|поко)\\s*([xfm]\\d)(?:\\s*(pro|gt|ultra))?${E}`, 'iu'),
    build: (m) => mk('xiaomi', 'phone', 'POCO', `${m[1].toUpperCase()}${m[2] ? ' ' + m[2].toUpperCase().replace('PRO', 'Pro').replace('ULTRA', 'Ultra') : ''}`),
  },
  {
    re: new RegExp(`${B}(?:xiaomi|сяоми|ксиаоми)\\s*(1\\d|\\d)(t)?(?:\\s*(pro|ultra|lite))?${E}`, 'iu'),
    build: (m) => mk('xiaomi', 'phone', 'Xiaomi', `${m[1]}${m[2] ? 'T' : ''}${m[3] ? ' ' + normalizeVariant(m[3]) : ''}`),
  },

  // ——— Приставки ———
  {
    re: new RegExp(`${B}(?:sony\\s*)?(?:playstation|плейстейшн|ps|пс)\\s*(5|4)(?:\\s*(pro|про|slim|слим|digital|диджитал))?${E}`, 'iu'),
    build: (m) => mk('sony', 'console', 'PlayStation', `${m[1]}${m[2] ? ' ' + normalizeVariant(m[2]) : ''}`),
  },
  {
    re: new RegExp(`${B}(?:xbox|иксбокс)\\s*(series\\s*[xs]|one\\s*[xs]?|360)${E}`, 'iu'),
    build: (m) => mk('microsoft', 'console', 'Xbox', ws(m[1]).replace(/series\s*/i, 'Series ').replace(/one\s*/i, 'One ').toUpperCase().replace('SERIES', 'Series').replace('ONE', 'One').trim()),
  },
  {
    re: new RegExp(`${B}(?:nintendo\\s*)?(?:switch|свитч)(?:\\s*(2|oled|олед|lite|лайт))?${E}`, 'iu'),
    build: (m) => mk('nintendo', 'console', 'Nintendo Switch', m[1] ? normalizeVariant(m[1]) : ''),
  },
  {
    re: new RegExp(`${B}(?:steam\\s*deck|стим\\s*дек)(?:\\s*(oled|олед))?${E}`, 'iu'),
    build: (m) => mk('valve', 'console', 'Steam Deck', m[1] ? 'OLED' : ''),
  },
];

/**
 * «Голый» айфон без слова iPhone: «15 Pro Max 256», «13 mini». Срабатывает только в магазинах,
 * где в профиле указан бренд по умолчанию apple, и только с вариантом или памятью рядом.
 */
const BARE_IPHONE = new RegExp(`${B}(1[1-7]e?)(?:\\s*(${V_IPHONE}))?(?=\\s*(?:\\d{2,4}\\s*(?:gb|гб|tb|тб)|1\\s*(?:tb|тб)|$|[,\\n]))`, 'iu');
const BARE_IPHONE_VARIANT = new RegExp(`${B}(1[1-7])\\s*(${V_IPHONE})${E}`, 'iu');

export interface MatchOptions {
  /** Бренд по умолчанию из профиля магазина: разрешает «15 Pro» без слова iPhone */
  defaultBrand?: string;
}

/** Найти первую модель в строке */
export function matchModel(text: string, opts: MatchOptions = {}): ModelMatch | null {
  let best: ModelMatch | null = null;
  for (const { re, build } of MATCHERS) {
    const m = re.exec(text);
    if (!m) continue;
    const built = build(m);
    if (!built) continue;
    const found: ModelMatch = { ...built, raw: ws(m[0]), index: m.index, end: m.index + m[0].length };
    // специфичные матчеры идут первыми; более ранняя позиция выигрывает только у другого бренда в той же строке
    if (!best || found.index < best.index) best = found;
  }
  if (best) return best;
  if (opts.defaultBrand === 'apple') {
    const m = BARE_IPHONE_VARIANT.exec(text) ?? BARE_IPHONE.exec(text);
    if (m) {
      const short = [iphoneNumber(m[1]), normalizeVariant(m[2])].filter(Boolean).join(' ');
      return { ...mk('apple', 'phone', 'iPhone', short), raw: ws(m[0]), index: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}
