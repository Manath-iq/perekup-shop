import { parsePost } from '@vitrina/core/parse';
import { formatStorage } from '@vitrina/core/format';
import type { CabinetData, CabinetMetric } from '@vitrina/core/types';
import { now } from './env';
import { visibleWhere, type ListingRow } from './db';
import type { Ctx } from './store';

const KPI_TYPES = ['app_open', 'card_view', 'buy_click', 'subscribe'] as const;

/** Данные кабинета продавца за последние days дней */
export async function cabinetData(ctx: Ctx, days: number): Promise<CabinetData> {
  const { env, store } = ctx;
  const since = now() - days * 86400;
  const prevSince = since - days * 86400;

  const counts = await env.DB.prepare(
    `SELECT type, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS cur, SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS prev
     FROM events WHERE store_id = ? AND created_at >= ? AND type IN ('app_open', 'card_view', 'buy_click', 'subscribe') GROUP BY type`,
  )
    .bind(since, since, store.id, prevSince)
    .all<{ type: string; cur: number; prev: number }>();
  const by = Object.fromEntries(counts.results.map((r) => [r.type, r]));
  const kpis = Object.fromEntries(KPI_TYPES.map((t) => [t, { value: by[t]?.cur ?? 0, prev: by[t]?.prev ?? 0 } satisfies CabinetMetric])) as CabinetData['kpis'];

  const stock = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM listings l WHERE ${visibleWhere(store)}) AS in_stock,
       (SELECT COUNT(*) FROM listings WHERE store_id = ? AND sold_at >= ?) AS sold`,
  )
    .bind(store.id, store.id, since)
    .first<{ in_stock: number; sold: number }>();

  // неуверенные карточки: разбор повторяем по тексту поста, чтобы показать, чего не хватило
  const pendingRows = await env.DB.prepare(
    `SELECT l.*, p.text FROM listings l JOIN posts p ON p.store_id = l.store_id AND p.msg_id = l.msg_id
     WHERE l.store_id = ? AND l.status IN ('active', 'reserved') AND l.parse_ok = 0 AND l.confirmed = 0
     ORDER BY l.created_at DESC LIMIT 10`,
  )
    .bind(store.id)
    .all<ListingRow & { text: string }>();
  const pending = pendingRows.results.map((l) => ({
    id: l.id,
    title: l.title,
    price: l.price,
    attrs: JSON.parse(l.attrs),
    text: l.text.length > 240 ? l.text.slice(0, 240) + '…' : l.text,
    parsed_by: l.parsed_by,
    missing: parsePost(l.text, store.profile).missing,
    post_url: l.post_url,
  }));

  // спрос без товара: поиски без результата за период и активные подписки — минус то, что сейчас есть
  const searches = await env.DB.prepare(
    `SELECT model_id, meta FROM events WHERE store_id = ? AND type = 'search' AND created_at >= ? AND model_id IS NOT NULL LIMIT 3000`,
  )
    .bind(store.id, since)
    .all<{ model_id: string; meta: string | null }>();
  const subs = await env.DB.prepare(
    `SELECT model_id, title, storage_gb, COUNT(DISTINCT tg_user_id) AS n FROM subscriptions WHERE store_id = ? AND active = 1 GROUP BY model_id, storage_gb`,
  )
    .bind(store.id)
    .all<{ model_id: string; title: string; storage_gb: number | null; n: number }>();
  const inStock = await env.DB.prepare(`SELECT DISTINCT l.model_id, l.storage_gb FROM listings l WHERE ${visibleWhere(store)} AND l.model_id IS NOT NULL`)
    .bind(store.id)
    .all<{ model_id: string; storage_gb: number | null }>();
  const have = (model: string, gb: number | null) => inStock.results.some((s) => s.model_id === model && (gb === null || s.storage_gb === gb));
  const demand = new Map<string, CabinetData['demand'][number]>();
  const bucket = (model_id: string, title: string, storage_gb: number | null) => {
    const key = `${model_id}|${storage_gb ?? ''}`;
    if (!demand.has(key)) demand.set(key, { model_id, title: storage_gb ? `${title} ${formatStorage(storage_gb)}` : title, storage_gb, searches: 0, waiting: 0 });
    return demand.get(key)!;
  };
  for (const s of searches.results) {
    const meta = s.meta ? (JSON.parse(s.meta) as { title?: string; storage_gb?: number | null; results?: number }) : {};
    if ((meta.results ?? 0) > 0 || have(s.model_id, meta.storage_gb ?? null)) continue;
    bucket(s.model_id, meta.title ?? s.model_id, meta.storage_gb ?? null).searches++;
  }
  for (const s of subs.results) if (!have(s.model_id, s.storage_gb)) bucket(s.model_id, s.title, s.storage_gb).waiting += s.n;

  const leads = await env.DB.prepare(
    `SELECT ld.id, ld.listing_id, ld.status, ld.created_at, l.title, l.storage_gb, l.price, u.username, u.first_name
     FROM leads ld JOIN listings l ON l.id = ld.listing_id LEFT JOIN users u ON u.tg_user_id = ld.tg_user_id
     WHERE ld.store_id = ? ORDER BY ld.created_at DESC LIMIT 20`,
  )
    .bind(store.id)
    .all<{ id: number; listing_id: number; status: 'new' | 'work' | 'sold'; created_at: number; title: string; storage_gb: number | null; price: number | null; username: string | null; first_name: string | null }>();

  const top = await env.DB.prepare(
    `SELECT e.listing_id, l.title, l.storage_gb, COUNT(*) AS views FROM events e JOIN listings l ON l.id = e.listing_id
     WHERE e.store_id = ? AND e.type = 'card_view' AND e.created_at >= ? GROUP BY e.listing_id ORDER BY views DESC LIMIT 5`,
  )
    .bind(store.id, since)
    .all<{ listing_id: number; title: string; storage_gb: number | null; views: number }>();

  const withGb = (t: string, gb: number | null) => (gb ? `${t} ${formatStorage(gb)}` : t);
  return {
    days,
    kpis,
    in_stock: stock?.in_stock ?? 0,
    sold: stock?.sold ?? 0,
    pending,
    demand: [...demand.values()].sort((a, b) => b.searches + b.waiting * 2 - (a.searches + a.waiting * 2)).slice(0, 8),
    leads: leads.results.map((l) => ({
      id: l.id,
      listing_id: l.listing_id,
      title: withGb(l.title, l.storage_gb),
      price: l.price,
      who: l.username ? `@${l.username}` : (l.first_name ?? 'Покупатель'),
      username: l.username,
      status: l.status,
      created_at: l.created_at,
    })),
    top: top.results.map((t) => ({ listing_id: t.listing_id, title: withGb(t.title, t.storage_gb), views: t.views })),
  };
}
