import { llmParsePost, mergeLlm, type LlmPost } from '@vitrina/core/llm';
import type { ParseResult } from '@vitrina/core/parse';
import type { Env } from './env';
import { now } from './env';

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Запасной разбор через Gemini — только когда правила не нашли модель, цену или обязательные поля.
 * Ответ кэшируется по хэшу текста; результат всё равно уходит продавцу на подтверждение.
 */
export async function llmFallback(env: Env, text: string, parsed: ParseResult, allowCall = true): Promise<ParseResult> {
  try {
    const hash = await sha256(text);
    const cached = await env.DB.prepare('SELECT result FROM llm_cache WHERE hash = ?').bind(hash).first<{ result: string }>();
    let llm: LlmPost;
    if (cached) llm = JSON.parse(cached.result);
    else {
      if (!allowCall || !env.GEMINI_API_KEY) return parsed;
      llm = await llmParsePost(text, { apiKey: env.GEMINI_API_KEY });
      await env.DB.prepare('INSERT OR REPLACE INTO llm_cache (hash, result, created_at) VALUES (?, ?, ?)').bind(hash, JSON.stringify(llm), now()).run();
    }
    return mergeLlm(parsed, llm);
  } catch (e) {
    console.error('llm fallback failed', String(e));
    return parsed;
  }
}
