import { geminiJson, GEMINI_PROFILE_MODELS, type GeminiOptions } from './llm';
import { parsePost, type ParseResult } from './parse';
import { DEFAULT_PROFILE, resolveProfile, stripVS, type ParseProfile } from './profile';

/**
 * Профиль разбора для нового канала: Gemini смотрит на образцы постов и называет метки продавца,
 * затем каждая метка сверяется с реальными текстами, а движок прогоняется по всей ленте.
 * Профиль, который разбирает хуже профиля по умолчанию, отбрасывается.
 */

const SCHEMA = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['active_marker', 'unless_sold'],
      description:
        'active_marker — если продавец помечает товары в наличии специальной меткой (хэштегом), а у проданных её убирает; unless_sold — если товар считается в наличии, пока не написано, что продан',
    },
    activeMarkers: { type: 'array', items: { type: 'string' }, description: 'Точные подстроки из постов, которые означают «в наличии», обычно хэштег' },
    soldMarkers: { type: 'array', items: { type: 'string' }, description: 'Точные подстроки, которые означают «продано»' },
    reservedMarkers: { type: 'array', items: { type: 'string' }, description: 'Точные подстроки, которые означают «бронь»' },
    ignoreMarkers: { type: 'array', items: { type: 'string' }, description: 'Подстроки постов, которые не являются объявлениями: отзывы, розыгрыши, график работы' },
    priceMarkers: { type: 'array', items: { type: 'string' }, description: 'Эмодзи или слово прямо перед ценой: «💰», «Цена»' },
    plusMarkers: { type: 'array', items: { type: 'string' }, description: 'Эмодзи в начале строк с достоинствами' },
    nuanceMarkers: { type: 'array', items: { type: 'string' }, description: 'Эмодзи в начале строк с недостатками' },
    conditionLabels: { type: 'array', items: { type: 'string' }, description: 'Подпись перед описанием состояния: «Состояние»' },
    defaultBrand: { type: 'string', enum: ['apple', 'samsung', 'xiaomi', 'google', 'none'], description: 'Бренд, если канал продаёт только его' },
    explanation: { type: 'string', description: 'Коротко: как этот продавец оформляет посты' },
  },
  required: ['mode', 'activeMarkers', 'soldMarkers', 'priceMarkers', 'plusMarkers', 'nuanceMarkers', 'defaultBrand', 'explanation'],
} as const;

interface LlmProfile {
  mode: ParseProfile['mode'];
  activeMarkers: string[];
  soldMarkers: string[];
  reservedMarkers?: string[];
  ignoreMarkers?: string[];
  priceMarkers: string[];
  plusMarkers: string[];
  nuanceMarkers: string[];
  conditionLabels?: string[];
  defaultBrand: string;
  explanation: string;
}

const SYSTEM =
  'Ты настраиваешь разбор постов Telegram-канала перекупщика техники. По образцам постов определи, как продавец оформляет объявления. ' +
  'Все метки — точные подстроки из текстов, без пересказа. Если чего-то нет — пустой массив.';

export interface ProfileReport {
  posts: number;
  listings: number;
  active: number;
  reserved: number;
  sold: number;
  notListing: number;
  confident: number;
  /** доля уверенно разобранных среди объявлений */
  share: number;
}

export function evaluate(texts: string[], profile: Partial<ParseProfile>): { report: ProfileReport; results: ParseResult[] } {
  const results = texts.map((t) => parsePost(t, profile));
  const count = (s: ParseResult['status']) => results.filter((r) => r.status === s).length;
  const listings = results.filter((r) => r.status !== 'not_listing');
  const confident = listings.filter((r) => r.parse_ok).length;
  return {
    results,
    report: {
      posts: texts.length,
      listings: listings.length,
      active: count('active'),
      reserved: count('reserved'),
      sold: count('sold'),
      notListing: count('not_listing'),
      confident,
      share: listings.length ? confident / listings.length : 0,
    },
  };
}

/** Оставить только метки, которые правда встречаются в постах (для строчных — в начале строки) */
function keepPresent(markers: string[] | undefined, texts: string[], atLineStart = false): string[] {
  const norm = texts.map((t) => stripVS(t).toLowerCase());
  const lines = atLineStart ? norm.flatMap((t) => t.split('\n').map((l) => l.trimStart())) : [];
  return [...new Set((markers ?? []).map((m) => stripVS(m).trim()).filter((m) => m.length >= 1 && m.length <= 40))].filter((m) => {
    const low = m.toLowerCase();
    return atLineStart ? lines.some((l) => l.startsWith(low)) : norm.some((t) => t.includes(low));
  });
}

/** Образцы для модели: свежие посты и немного старых, где чаще видны отметки «продано» */
function samples(texts: string[], n = 28): string[] {
  const withText = texts.filter((t) => t.trim().length > 20);
  const head = withText.slice(0, Math.ceil(n * 0.6));
  const tail = withText.slice(head.length).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / (n - head.length))) === 0);
  return [...head, ...tail].slice(0, n).map((t) => (t.length > 700 ? t.slice(0, 700) + '…' : t));
}

export async function generateProfile(texts: string[], opts: Omit<GeminiOptions, 'model'> & { model?: string }) {
  const sample = samples(texts);
  const prompt = sample.map((t, i) => `### Пост ${i + 1}\n${t}`).join('\n\n');
  let llm: LlmProfile | null = null;
  let lastError: unknown;
  for (const model of opts.model ? [opts.model] : GEMINI_PROFILE_MODELS) {
    try {
      llm = await geminiJson<LlmProfile>(prompt, SCHEMA, { system: SYSTEM, timeoutMs: 60_000, ...opts, model });
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!llm) throw lastError;

  const active = keepPresent(llm.activeMarkers, texts);
  // «не объявление» не может стоять в постах, которые движок уверенно разобрал как товар:
  // у RaXi внизу каждого поста ссылка «Отзывы», и модель приняла её за метку отзывов
  const base = evaluate(texts, {});
  const listingTexts = texts.filter((_, i) => base.results[i].parse_ok).map((t) => stripVS(t).toLowerCase());
  const ignore = keepPresent(llm.ignoreMarkers, texts).filter((m) => !listingTexts.some((t) => t.includes(m.toLowerCase())));
  // «продано», которое есть почти в каждом посте, — это не метка продажи, а часть шаблона
  const sold = keepPresent(llm.soldMarkers, texts).filter((m) => texts.filter((t) => stripVS(t).toLowerCase().includes(m.toLowerCase())).length < texts.length * 0.95);
  const labels = (llm.conditionLabels ?? []).map((l) => l.replace(/[:\s]+$/, ''));
  const candidate: Partial<ParseProfile> = {
    mode: llm.mode === 'active_marker' && active.length ? 'active_marker' : 'unless_sold',
    activeMarkers: active.length ? active : DEFAULT_PROFILE.activeMarkers,
    soldMarkers: [...new Set([...sold, ...DEFAULT_PROFILE.soldMarkers])],
    reservedMarkers: [...new Set([...keepPresent(llm.reservedMarkers, texts), ...DEFAULT_PROFILE.reservedMarkers])],
    ignoreMarkers: [...new Set([...ignore, ...DEFAULT_PROFILE.ignoreMarkers])],
    priceMarkers: [...new Set([...keepPresent(llm.priceMarkers, texts), ...DEFAULT_PROFILE.priceMarkers])],
    plusMarkers: [...new Set([...keepPresent(llm.plusMarkers, texts, true), ...DEFAULT_PROFILE.plusMarkers])],
    nuanceMarkers: [...new Set([...keepPresent(llm.nuanceMarkers, texts, true), ...DEFAULT_PROFILE.nuanceMarkers])],
    conditionLabels: [...new Set([...keepPresent(labels, texts), ...DEFAULT_PROFILE.conditionLabels])],
    ...(llm.defaultBrand && llm.defaultBrand !== 'none' ? { defaultBrand: llm.defaultBrand } : {}),
  };

  const gen = evaluate(texts, candidate);
  // метка «в наличии», которой нет ни у одного разобранного поста, — ошибка модели
  const plausible = gen.report.active + gen.report.reserved > 0 || base.report.active === 0;
  const better = plausible && gen.report.confident >= base.report.confident * 0.9;
  return {
    candidate,
    candidateReport: gen.report,
    profile: resolveProfile(better ? candidate : {}),
    chosen: better ? ('generated' as const) : ('default' as const),
    explanation: llm.explanation,
    report: better ? gen.report : base.report,
    baseline: base.report,
  };
}
