/** Настройки магазина: clients/<slug>/client.jsonc у клиента, строка в D1 у демо */
export interface StoreConfig {
  slug: string;
  name: string;
  /** username публичного канала без @ или id приватного канала */
  channel: string;
  /** username продавца без @ — сюда ведёт «Купить» */
  seller: string;
  reviewsChannel?: string;
  /** Аватар канала — для демо берётся со страницы t.me */
  avatar?: string;
  theme?: { preset?: 'graphite' | 'paper' | 'neon'; accent?: string };
  about?: { city?: string; delivery?: string; warranty?: string; payment?: string };
}

/**
 * Параметр запуска мини-аппа: `apple_raxi`, `apple_raxi--l12`, `l12`, `l_12` (старые ссылки прототипа).
 * Магазин нужен демо-деплою, где на одном боте много магазинов; у клиентского деплоя он один.
 */
export function parseStartParam(p: string | null | undefined): { store?: string; listing?: number } {
  const out: { store?: string; listing?: number } = {};
  for (const token of (p ?? '').split('--')) {
    const l = token.match(/^l_?(\d+)$/);
    if (l) out.listing = +l[1];
    else if (/^[\w-]{2,64}$/.test(token)) out.store = token;
  }
  return out;
}

export const startParam = (store: string | null, listing?: number) =>
  [store, listing ? `l${listing}` : null].filter(Boolean).join('--');
