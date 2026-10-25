import { CATEGORIES, matchModel, type Attrs, type Category } from './catalog';
import type { ParseResult, PostStatus } from './parse';

/** Модель для разбора постов: дешёвая и быстрая. Алиас Google указывает на актуальную flash-lite. */
export const GEMINI_PARSE_MODEL = 'gemini-flash-lite-latest';
/** Модель для генерации профилей разбора: один раз на клиента */
export const GEMINI_PROFILE_MODEL = 'gemini-flash-latest';

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });

/** JSON-схема ответа: те же поля, что у движка, чтобы результат сливался без перевода */
export const POST_SCHEMA = {
  type: 'object',
  properties: {
    is_listing: { type: 'boolean', description: 'Это объявление о продаже конкретного товара, а не анонс, отзыв или реклама' },
    status: { type: 'string', enum: ['active', 'reserved', 'sold'], description: 'sold — если в посте написано, что продано' },
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    model: nullable('string', { description: 'Полное название модели, например "iPhone 15 Pro Max", "MacBook Air M2", "AirPods Pro 2"' }),
    price_rub: nullable('integer', { description: 'Цена продажи в рублях целым числом' }),
    storage_gb: nullable('integer', { description: 'Встроенная память в ГБ, 1TB = 1024' }),
    ram_gb: nullable('integer'),
    battery_pct: nullable('integer', { description: 'Ёмкость аккумулятора в процентах' }),
    battery_cycles: nullable('integer'),
    chip: nullable('string'),
    color: nullable('string'),
    condition: nullable('string', { description: 'Состояние своими словами продавца, коротко' }),
    original: nullable('boolean'),
    pluses: { type: 'array', items: { type: 'string' } },
    nuances: { type: 'array', items: { type: 'string' }, description: 'Дефекты и нюансы, о которых пишет продавец' },
  },
  required: ['is_listing', 'status', 'category', 'model', 'price_rub'],
} as const;

export interface LlmPost {
  is_listing: boolean;
  status: 'active' | 'reserved' | 'sold';
  category: Category;
  model: string | null;
  price_rub: number | null;
  storage_gb?: number | null;
  ram_gb?: number | null;
  battery_pct?: number | null;
  battery_cycles?: number | null;
  chip?: string | null;
  color?: string | null;
  condition?: string | null;
  original?: boolean | null;
  pluses?: string[];
  nuances?: string[];
}

export const POST_SYSTEM_PROMPT =
  'Ты разбираешь посты из Telegram-канала перекупщика техники (б/у и новые телефоны, ноутбуки, планшеты, часы, наушники, приставки). ' +
  'Извлеки поля строго по JSON-схеме. Если поля в тексте нет — верни null, ничего не выдумывай. Сленг: «акб» — аккумулятор, «про макс» — Pro Max, «60к» — 60 000 ₽.';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  system?: string;
  /** Подмена fetch для тестов */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Вызов Gemini с ответом строго по JSON-схеме. Работает и в Workers, и в Node. */
export async function geminiJson<T>(prompt: string, schema: object, opts: GeminiOptions): Promise<T> {
  const f = opts.fetch ?? fetch;
  const model = opts.model ?? GEMINI_PARSE_MODEL;
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('gemini: пустой ответ');
  return JSON.parse(text) as T;
}

export const llmParsePost = (text: string, opts: GeminiOptions) =>
  geminiJson<LlmPost>(text, POST_SCHEMA, { system: POST_SYSTEM_PROMPT, ...opts });

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/**
 * Дополнить разбор движка ответом модели: найденное движком не перетирается.
 * Результат всегда требует подтверждения продавца — parse_ok сбрасывается.
 */
export function mergeLlm(base: ParseResult, llm: LlmPost): ParseResult {
  const model = base.model ?? (llm.model ? matchModel(llm.model) : null);
  const category = model?.category ?? (base.category !== 'other' ? base.category : llm.category) ?? 'other';
  const attrs: Attrs = { ...base.attrs };
  const fill = <K extends keyof Attrs>(k: K, v: Attrs[K] | undefined) => {
    if (attrs[k] === undefined && v !== undefined && v !== null) attrs[k] = v;
  };
  fill('storage_gb', num(llm.storage_gb));
  fill('ram_gb', num(llm.ram_gb));
  fill('battery_pct', num(llm.battery_pct));
  fill('battery_cycles', num(llm.battery_cycles));
  fill('chip', llm.chip ?? undefined);
  fill('color', llm.color ?? undefined);
  fill('condition', llm.condition ?? undefined);
  if (category === 'audio' || category === 'watch') fill('original', llm.original ?? undefined);

  let status: PostStatus = base.status;
  if (!llm.is_listing && base.status !== 'sold') status = 'not_listing';
  else if (base.status === 'not_listing' && llm.is_listing) status = llm.status;

  const price = base.price ?? num(llm.price_rub) ?? null;
  const missing = base.missing.filter((k) => {
    if (k === 'model') return !model;
    if (k === 'price') return price === null;
    return attrs[k as keyof Attrs] === undefined;
  });
  return {
    ...base,
    status,
    category,
    model: model ? { id: model.id, brand: model.brand, category: model.category, line: model.line, short: model.short, title: model.title, raw: model.raw } : null,
    title: model?.title ?? llm.model ?? base.title,
    price,
    attrs,
    pluses: base.pluses.length ? base.pluses : (llm.pluses ?? []),
    nuances: base.nuances.length ? base.nuances : (llm.nuances ?? []),
    missing,
    parse_ok: false,
    source: 'llm',
  };
}
