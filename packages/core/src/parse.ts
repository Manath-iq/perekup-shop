import { CATEGORIES, matchModel, type Attrs, type AttrKey, type Category, type ModelMatch } from './catalog';
import { leadingMarker, markerTest, resolveProfile, stripVS, type ParseProfile } from './profile';

export type PostStatus = 'active' | 'reserved' | 'sold' | 'not_listing';

/** Результат разбора поста. Поля, которые не нашлись, отсутствуют или null. */
export interface ParseResult {
  status: PostStatus;
  /** marker — статус задан меткой в посте, inferred — выведен из её отсутствия */
  status_source: 'marker' | 'inferred';
  category: Category;
  model: Omit<ModelMatch, 'index' | 'end'> | null;
  /** Заголовок карточки: модель из словаря или первая строка поста */
  title: string | null;
  price: number | null;
  old_price: number | null;
  attrs: Attrs;
  pluses: string[];
  nuances: string[];
  /** 0…1 — насколько разбору можно верить без продавца */
  confidence: number;
  /** Обязательные поля, которых не нашлось */
  missing: string[];
  /** Модель, цена и обязательные для категории поля найдены, уверенность не ниже порога */
  parse_ok: boolean;
  /** rules — разобрано правилами, llm — дополнено моделью */
  source: 'rules' | 'llm';
}

const VALID_STORAGE = new Set([16, 32, 64, 128, 256, 500, 512, 825, 1024, 2048, 4096, 8192]);
const L = '(?![\\p{L}])';

/** NBSP и узкие пробелы → обычные, без вариационных селекторов и BOM */
export function normalizeText(s: string): string {
  return stripVS(s)
    .replace(/[    ]/g, ' ')
    .replace(/[​﻿]/g, '')
    .replace(/\r\n?/g, '\n');
}

const cleanLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** «Около идеал 🔥» → «Около идеал»: текст без эмодзи, с заглавной */
function normalizeCondition(raw: string): string {
  const text = raw.replace(/[\p{Extended_Pictographic}‍]/gu, '').replace(/\s+/g, ' ').trim();
  if (!text) return raw.trim();
  return capitalize(text.toLowerCase());
}

// ——— Экстракторы ———

const STORAGE_RE = new RegExp(`(?<![\\d.,])(\\d{1,4})\\s*(gb|гб|gig|tb|тб)${L}`, 'giu');

function toGb(n: number, unit: string) {
  return /t/i.test(unit) ? n * 1024 : n;
}

export function extractStorage(line: string, afterModel?: string): number | undefined {
  for (const m of line.matchAll(STORAGE_RE)) {
    const gb = toGb(parseInt(m[1], 10), m[2]);
    // «8/256GB»: первое число — оперативка, она не из ряда объёмов памяти и пропускается
    if (VALID_STORAGE.has(gb) && gb >= 32) return gb;
  }
  // «iPhone 13 128» — память без единиц сразу после модели
  if (afterModel) {
    const bare = afterModel.match(/^\s*[,/]?\s*(\d{2,4})(?![\d\p{L}])/u);
    if (bare && VALID_STORAGE.has(+bare[1]) && +bare[1] >= 32) return +bare[1];
    const tb = afterModel.match(/^\s*(\d)\s*(tb|тб)/iu);
    if (tb) return +tb[1] * 1024;
  }
  return undefined;
}

/** «16/512», «16 GB RAM», «ОЗУ 8» */
function extractRam(text: string): number | undefined {
  const pair = text.match(/(?<![\d.])(\d{1,2})\s*(?:gb|гб)?\s*[/|]\s*(\d{3,4}|\d\s*(?:tb|тб))(?:\s*(?:gb|гб|tb|тб|ssd))?/iu);
  if (pair) return +pair[1];
  const ram = text.match(/(?:ram|озу|оперативн\p{L}*)\s*[:\-]?\s*(\d{1,3})|(\d{1,3})\s*(?:gb|гб)\s*(?:ram|озу)/iu);
  if (ram) return +(ram[1] ?? ram[2]);
  return undefined;
}

function extractSsd(text: string): number | undefined {
  const pair = text.match(/(?<![\d.])\d{1,2}\s*(?:gb|гб)?\s*[/|]\s*(\d{3,4}|\d\s*(?:tb|тб))/iu);
  if (pair) return /t/i.test(pair[1]) ? parseInt(pair[1], 10) * 1024 : +pair[1];
  const ssd = text.match(/(?:ssd|ссд)\s*[:\-]?\s*(\d{1,4})\s*(gb|гб|tb|тб)?|(\d{1,4})\s*(gb|гб|tb|тб)\s*(?:ssd|ссд)/iu);
  if (ssd) return toGb(+(ssd[1] ?? ssd[3]), ssd[2] ?? ssd[4] ?? 'gb');
  return undefined;
}

const BATTERY_RE =
  /(?:акб|акк\p{L}*|батаре\p{L}*|battery|batt|[её]мкост\p{L}*|🔋)[^\d\n]{0,12}?(\d{2,3})\s*%|(\d{2,3})\s*%\s*(?:акб|акк\p{L}*|батаре\p{L}*|battery|[её]мкост\p{L}*)/iu;
const CYCLES_RE = /(\d{1,4})\s*(?:циклов|цикла|цикл|ц\.?(?![\p{L}])|cycles?)/iu;

function extractBattery(text: string): { pct?: number; cycles?: number } {
  const m = text.match(BATTERY_RE);
  const pct = m ? Math.min(100, parseInt(m[1] ?? m[2], 10)) : undefined;
  const c = text.match(CYCLES_RE);
  return { pct: pct && pct >= 40 ? pct : undefined, cycles: c ? parseInt(c[1], 10) : undefined };
}

const OS_RE = /(?:ios|айос|android|андроид)\s*(\d{1,2}(?:\.\d{1,2}){0,2})/iu;

function extractSim(lines: string[], profile: ParseProfile): { sim?: string; physical?: boolean } {
  for (const l of lines) {
    if (!/sim|сим(?![\p{L}])|симк/iu.test(l)) continue;
    if (leadingMarker(l, profile.plusMarkers) !== null || leadingMarker(l, profile.nuanceMarkers) !== null) continue;
    const sim = cleanLine(l.replace(/[\p{Extended_Pictographic}‍]/gu, ''));
    if (sim.length > 40) continue;
    const low = sim.toLowerCase();
    const physical = /2\s*sim|nano|sim\s*\+|\+\s*sim|физ|dual|две/.test(low) || !/esim|е-?сим/.test(low);
    return { sim, physical };
  }
  return {};
}

function extractChip(text: string): string | undefined {
  const m = text.match(/(?<![\p{L}\d])(m[1-5])(?:\s*(pro|max|ultra))?(?![\p{L}\d])/iu);
  if (m) return `${m[1].toUpperCase()}${m[2] ? ' ' + capitalize(m[2].toLowerCase()) : ''}`;
  const intel = text.match(/(?<![\p{L}\d])(i[3579])[-\s]?(\d{4,5}[a-z]{0,2})?(?![\p{L}\d])/iu);
  if (intel) return `Intel Core ${intel[1].toLowerCase()}${intel[2] ? '-' + intel[2].toUpperCase() : ''}`;
  return undefined;
}

function extractScreen(text: string, afterModel?: string): number | undefined {
  const m = text.match(/(?<![\d.])(\d{2}(?:[.,]\d)?)\s*(?:"|''|”|″|дюйм\p{L}*|inch)/iu);
  if (m) return parseFloat(m[1].replace(',', '.'));
  const after = afterModel?.match(/^\s*(1[1-7](?:[.,]\d)?)(?![\d\p{L}])/u);
  return after ? parseFloat(after[1].replace(',', '.')) : undefined;
}

const COLORS: [RegExp, string][] = [
  [/natural\s*titanium|titanium\s*natural|натуральн\p{L}*\s*титан/iu, 'Натуральный титан'],
  [/desert\s*titanium|titanium\s*desert|пустынн\p{L}*\s*титан/iu, 'Пустынный титан'],
  [/black\s*titanium|titanium\s*black|ч[её]рн\p{L}*\s*титан/iu, 'Чёрный титан'],
  [/white\s*titanium|titanium\s*white|бел\p{L}*\s*титан/iu, 'Белый титан'],
  [/blue\s*titanium|titanium\s*blue|син\p{L}*\s*титан/iu, 'Синий титан'],
  [/cosmic\s*orange|оранжев\p{L}*/iu, 'Оранжевый'],
  [/deep\s*blue|тёмно-син\p{L}*|темно-син\p{L}*/iu, 'Тёмно-синий'],
  [/space\s*gr[ae]y|серый\s*космос/iu, 'Серый космос'],
  [/starlight|сияющ\p{L}*\s*звезд\p{L}*/iu, 'Сияющая звезда'],
  [/midnight|т[её]мн\p{L}*\s*ноч\p{L}*|полночь/iu, 'Тёмная ночь'],
  [/ultramarine|ультрамарин/iu, 'Ультрамарин'],
  [/(?<![\p{L}])(black|ч[её]рн\p{L}*)/iu, 'Чёрный'],
  [/(?<![\p{L}])(white|бел(?:ый|ая|ое|ого)(?![\p{L}]))/iu, 'Белый'],
  [/(?<![\p{L}])(silver|серебрист\p{L}*)/iu, 'Серебристый'],
  [/(?<![\p{L}])(gold|золот\p{L}*)/iu, 'Золотой'],
  [/(?<![\p{L}])(gr[ae]y|сер(?:ый|ая|ое)(?![\p{L}]))/iu, 'Серый'],
  [/(?<![\p{L}])(blue|син(?:ий|яя|ее)(?![\p{L}])|голуб\p{L}*)/iu, 'Синий'],
  [/(?<![\p{L}])(green|зел[её]н\p{L}*)/iu, 'Зелёный'],
  [/(?<![\p{L}])(pink|розов\p{L}*)/iu, 'Розовый'],
  [/(?<![\p{L}])(purple|фиолетов\p{L}*|лаванд\p{L}*)/iu, 'Фиолетовый'],
  [/(?<![\p{L}])(red|красн\p{L}*)/iu, 'Красный'],
  [/(?<![\p{L}])(yellow|ж[её]лт\p{L}*)/iu, 'Жёлтый'],
  [/(?<![\p{L}])(graphite|графит\p{L}*)/iu, 'Графитовый'],
];

/** Цвет ищем только в заголовке и строке «Цвет:», чтобы не путать с «чёрным экраном» в нюансах */
function extractColor(titleLine: string, lines: string[]): string | undefined {
  const labelled = lines.find((l) => /^\s*(?:цвет|color)\s*[:\-]/iu.test(l));
  for (const src of [labelled, titleLine]) {
    if (!src) continue;
    for (const [re, name] of COLORS) if (re.test(src)) return name;
  }
  return undefined;
}

function extractOriginal(text: string): boolean | undefined {
  if (/реплик\p{L}*|копи[яи](?![\p{L}])|replica|люкс\s*копи|1\s*[:в]\s*1|lux(?![\p{L}])/iu.test(text)) return false;
  if (/оригинал|original|оригинальн\p{L}*/iu.test(text)) return true;
  return undefined;
}

// ——— Цена ———

/** «43 990», «43.990», «43990» → 43990; «60к» → 60000 */
function toPrice(digits: string, suffix?: string): number | null {
  let n = parseInt(digits.replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  if (suffix && /^(к|k|тыс)/iu.test(suffix)) n = Math.round(parseFloat(digits.replace(/\s/g, '').replace(',', '.')) * 1000);
  return n >= 500 && n <= 5_000_000 ? n : null;
}

const NUM = '(\\d{1,3}(?:[ .,]\\d{3})+|\\d{3,7}|\\d{2,3}(?:[.,]\\d)?(?=\\s*(?:к|k|тыс)))';
const K_SUFFIX = '\\s*(к|k|тыс\\.?)?(?![\\p{L}])';
const CURRENCY_RE = new RegExp(`${NUM}\\s*(?:₽|руб\\p{L}*\\.?|р\\.?(?![\\p{L}])|rub)`, 'iu');
const K_RE = new RegExp(`(?<![\\d.,])(\\d{2,3}(?:[.,]\\d)?)\\s*(к|k|тыс\\.?)(?![\\p{L}])`, 'iu');
const OLD_PRICE_LINE = /был[оа]?|старая\s*цена|вместо|без\s*скидки/iu;

function extractPrice(lines: string[], profile: ParseProfile): { price: number | null; old: number | null } {
  const isPriceMarker = markerTest(profile.priceMarkers);
  let old: number | null = null;
  const pick = (re: RegExp, filter: (l: string) => boolean) => {
    for (const l of lines) {
      if (!filter(l)) continue;
      const m = l.match(re);
      if (!m) continue;
      const p = toPrice(m[1], m[2]);
      if (!p) continue;
      if (OLD_PRICE_LINE.test(l)) {
        old ??= p;
        continue;
      }
      return p;
    }
    return null;
  };
  const afterMarker = new RegExp(`${NUM}${K_SUFFIX}`, 'u');
  const price =
    // 1. строка с меткой цены: число после метки
    pick(afterMarker, (l) => isPriceMarker(l) && !/акб|%/iu.test(l)) ??
    // 2. число с валютой
    pick(CURRENCY_RE, () => true) ??
    // 3. «60к» в любой строке
    pick(K_RE, (l) => !/акб|%|мм|mm/iu.test(l));
  if (old === null) {
    // «Было 52 000» без валюты
    for (const l of lines) {
      if (!OLD_PRICE_LINE.test(l)) continue;
      const m = l.match(afterMarker);
      const p = m && toPrice(m[1], m[2]);
      if (p && p !== price) {
        old = p;
        break;
      }
    }
  }
  return { price, old };
}

// ——— Главная функция ———

export function parsePost(rawText: string, profileInput?: Partial<ParseProfile> | null): ParseResult {
  const profile = resolveProfile(profileInput);
  const text = normalizeText(rawText);
  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim());

  // Модель: сначала первая строка, где она нашлась, потом весь текст
  let model: ModelMatch | null = null;
  let titleLine = '';
  for (const l of nonEmpty) {
    const m = matchModel(l, { defaultBrand: profile.defaultBrand });
    if (m) {
      model = m;
      titleLine = l;
      break;
    }
  }
  if (!titleLine) titleLine = nonEmpty[0] ?? '';
  const afterModel = model ? titleLine.slice(model.end) : undefined;
  const category: Category = model?.category ?? 'other';

  const attrs: Attrs = {};
  const storage = extractStorage(titleLine, afterModel) ?? (category !== 'computer' ? extractStorage(text) : undefined);
  if (category === 'computer') {
    attrs.ram_gb = extractRam(text);
    attrs.storage_gb = extractSsd(text) ?? storage;
  } else if (storage) attrs.storage_gb = storage;

  const bat = extractBattery(text);
  attrs.battery_pct = bat.pct;
  attrs.battery_cycles = bat.cycles;
  attrs.os_version = text.match(OS_RE)?.[1];
  if (category === 'phone' || category === 'tablet') {
    const sim = extractSim(lines, profile);
    attrs.sim = sim.sim;
    attrs.physical_sim = sim.physical;
  }
  if (category === 'computer' || category === 'tablet') {
    attrs.chip = extractChip(text);
    attrs.screen_in = extractScreen(titleLine, afterModel) ?? extractScreen(text);
  }
  if (category === 'watch') {
    const mm = text.match(/(?<!\d)(38|40|41|42|44|45|46|49)\s*(?:mm|мм)/iu);
    attrs.case_mm = mm ? +mm[1] : undefined;
  }
  if (category === 'audio' || category === 'watch') attrs.original = extractOriginal(text);
  attrs.color = extractColor(titleLine, lines);

  // Состояние: строка «Состояние: …», иначе ключевые слова
  const condLabel = new RegExp(`(?:${profile.conditionLabels.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?!\\s*(?:акб|акк|батар|battery))\\s*[:\\-–—]\\s*([^\\n]+)`, 'iu');
  const cond = text.match(condLabel);
  if (cond) attrs.condition = normalizeCondition(cond[1]);
  else {
    const kw = text.match(/(?<![\p{L}])(новы[йе]|новое|запечатан\p{L}*|как\s+нов\p{L}*|идеал\p{L}*|отличн\p{L}*|хорош\p{L}*)(?![\p{L}])/iu);
    if (kw) attrs.condition = capitalize(kw[1].toLowerCase());
  }

  // Плюсы и нюансы по меткам в начале строки
  const isSold = markerTest(profile.soldMarkers);
  const pluses: string[] = [];
  const nuances: string[] = [];
  for (const raw of lines) {
    const plus = leadingMarker(raw, profile.plusMarkers);
    const nuance = plus === null ? leadingMarker(raw, profile.nuanceMarkers) : null;
    const body = cleanLine(plus ?? nuance ?? '');
    if (!body || isSold(raw)) continue;
    if (/^полный\s+комплект/iu.test(body)) {
      attrs.kit = 'Полный комплект';
      attrs.full_kit = true;
    } else if (/^комплект\s*:/iu.test(body)) {
      attrs.kit = cleanLine(body.replace(/^комплект\s*:/iu, ''));
    }
    // АКБ и версия ОС уже разобраны в отдельные поля
    if (plus !== null && (BATTERY_RE.test(body) || /^(ios|android)\s*\d/iu.test(body))) continue;
    (plus !== null ? pluses : nuances).push(body);
  }
  if (!attrs.kit && /(?<![\p{L}])полный\s+комплект/iu.test(text)) {
    attrs.kit = 'Полный комплект';
    attrs.full_kit = true;
  }
  if (attrs.kit && attrs.full_kit === undefined) attrs.full_kit = false;

  const { price, old } = extractPrice(lines, profile);

  // Статус
  const has = (markers: string[]) => markerTest(markers)(text);
  const sold = has(profile.soldMarkers);
  const reserved = has(profile.reservedMarkers);
  const active = has(profile.activeMarkers);
  // в режиме active_marker метка сама говорит «это товар», даже если модель не распозналась
  const looksListing = !!model || (price !== null && nonEmpty.length >= 2) || (profile.mode === 'active_marker' && active);
  let status: PostStatus;
  let status_source: ParseResult['status_source'] = 'marker';
  if (has(profile.ignoreMarkers) || !looksListing) {
    status = 'not_listing';
    status_source = 'inferred';
  } else if (profile.mode === 'active_marker') {
    if (active && !sold) status = reserved ? 'reserved' : 'active';
    else {
      status = 'sold';
      if (!sold) status_source = 'inferred';
    }
  } else if (sold) status = 'sold';
  else {
    status = reserved ? 'reserved' : 'active';
    if (!reserved && !active) status_source = 'inferred';
  }

  // Уверенность
  const required: AttrKey[] = CATEGORIES[category].required;
  const missing: string[] = [];
  if (!model) missing.push('model');
  if (price === null) missing.push('price');
  for (const k of required) if (attrs[k] === undefined) missing.push(k);
  let confidence = (model ? 0.4 : 0) + (price !== null ? 0.35 : 0) + (status_source === 'marker' ? 0.1 : 0.05);
  confidence += required.length ? (0.15 * required.filter((k) => attrs[k] !== undefined).length) / required.length : model ? 0.15 : 0;
  confidence = Math.round(confidence * 100) / 100;

  for (const k of Object.keys(attrs) as AttrKey[]) if (attrs[k] === undefined) delete attrs[k];

  const fallbackTitle = cleanLine(titleLine.replace(/[\p{Extended_Pictographic}‍]/gu, '')) || null;
  return {
    status,
    status_source,
    category,
    model: model ? { id: model.id, brand: model.brand, category: model.category, line: model.line, short: model.short, title: model.title, raw: model.raw } : null,
    title: model?.title ?? fallbackTitle,
    price,
    old_price: old,
    attrs,
    pluses,
    nuances,
    confidence,
    missing,
    parse_ok: missing.length === 0 && confidence >= profile.threshold,
    source: 'rules',
  };
}
