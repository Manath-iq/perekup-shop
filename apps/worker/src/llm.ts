import type { ParsedPost } from '@vitrina/core/types';
import { parseModel } from '@vitrina/core/parser';
import type { Env } from './env';

const SCHEMA = {
  type: 'object',
  properties: {
    model: { type: 'string', description: 'Модель, например "iPhone 15 Pro Max"' },
    storage_gb: { type: 'integer', description: 'Память в ГБ, 1TB = 1024' },
    price_rub: { type: 'integer', description: 'Цена в рублях целым числом' },
    battery_pct: { type: 'integer' },
    condition: { type: 'string' },
  },
  required: ['model', 'storage_gb', 'price_rub'],
};

/** Запасной разбор: вызывается только когда регулярки не нашли модель, память или цену */
export async function llmFallback(env: Env, text: string, parsed: ParsedPost): Promise<ParsedPost> {
  try {
    const out = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as keyof AiModels, {
      messages: [
        { role: 'system', content: 'Извлеки из объявления о продаже телефона поля строго по JSON-схеме. Если поля нет — не выдумывай.' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    } as never)) as { response?: unknown };
    const data = (typeof out.response === 'string' ? JSON.parse(out.response) : out.response) as Record<string, unknown>;
    const model = typeof data.model === 'string' ? parseModel(data.model) : null;
    return {
      ...parsed,
      category: model ? 'iphone' : parsed.category,
      model_raw: parsed.model_raw ?? (data.model as string) ?? null,
      family: parsed.family ?? model?.family ?? null,
      storage_gb: parsed.storage_gb ?? (Number(data.storage_gb) || null),
      price_rub: parsed.price_rub ?? (Number(data.price_rub) || null),
      battery_pct: parsed.battery_pct ?? (Number(data.battery_pct) || null),
      condition: parsed.condition ?? ((data.condition as string) || null),
      // результат модели всё равно идёт продавцу на подтверждение
      parse_ok: false,
    };
  } catch (e) {
    console.error('llm fallback failed', e);
    return parsed;
  }
}
