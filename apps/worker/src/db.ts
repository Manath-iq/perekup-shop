import { CATEGORIES, type Attrs, type Category } from '@vitrina/core/catalog';
import type { Facets, Listing, ListingStatus, MediaItem, ModelFacet, Subscription } from '@vitrina/core/types';
import type { Ctx, Store } from './store';
import { now } from './env';
import { TG_FILE_LIMIT } from './media';

export interface ListingRow {
  id: number;
  store_id: string;
  msg_id: number;
  /** 0 — обычный пост, 1…n — строка поста-прайса */
  item: number;
  media_group_id: string | null;
  category: Category;
  brand: string | null;
  model_id: string | null;
  line: string | null;
  short: string | null;
  title: string;
  price: number | null;
  storage_gb: number | null;
  battery_pct: number | null;
  condition: string | null;
  physical_sim: number | null;
  attrs: string;
  pluses: string;
  nuances: string;
  status: ListingStatus;
  confidence: number;
  parse_ok: number;
  parsed_by: 'rules' | 'llm';
  confirmed: number;
  post_url: string;
  created_at: number;
  updated_at: number;
  sold_at: number | null;
}

export const mediaUrl = (key: string) => `/media/${key}`;

export function toListing(r: ListingRow & { cover_key?: string | null; cover_blur?: string | null; old_price?: number | null }): Listing {
  const attrs: Attrs = JSON.parse(r.attrs);
  return {
    id: r.id,
    msg_id: r.msg_id,
    category: r.category,
    brand: r.brand,
    model_id: r.model_id,
    line: r.line,
    short: r.short,
    title: r.title,
    price: r.price,
    old_price: r.old_price && r.price && r.old_price > r.price ? r.old_price : null,
    attrs,
    pluses: JSON.parse(r.pluses),
    nuances: JSON.parse(r.nuances),
    status: r.status,
    post_url: r.post_url,
    created_at: r.created_at,
    cover: r.cover_key ? mediaUrl(r.cover_key) : null,
    cover_blur: r.cover_blur ?? null,
  };
}

/**
 * Что видит покупатель: в наличии или в брони. Неуверенно разобранные карточки клиента ждут «Всё верно»;
 * у демо подтверждать некому, поэтому достаточно модели и цены.
 */
export function visibleWhere(store: Store) {
  const confirmed =
    store.kind === 'demo' ? '(l.parse_ok = 1 OR l.confirmed = 1 OR (l.model_id IS NOT NULL AND l.price IS NOT NULL))' : '(l.parse_ok = 1 OR l.confirmed = 1)';
  return `l.store_id = ? AND l.status IN ('active', 'reserved') AND ${confirmed}`;
}

// обложка — единственная запись медиа карточки, у которой есть ключ KV
const LISTING_SELECT = `
  SELECT l.*, c.storage_key AS cover_key, c.blur AS cover_blur,
    (SELECT price FROM price_history p WHERE p.listing_id = l.id ORDER BY changed_at DESC LIMIT 1) AS old_price
  FROM listings l
  LEFT JOIN media c ON c.id = (SELECT id FROM media WHERE listing_id = l.id AND storage_key IS NOT NULL AND storage_key != 'skip' LIMIT 1)`;

export interface ListingQuery {
  category?: string;
  model_id?: string;
  storage?: number;
  price_min?: number;
  price_max?: number;
  battery_min?: number;
  condition?: string;
  sim?: 'physical' | 'esim';
  sort?: 'new' | 'cheap' | 'expensive' | 'battery';
}

export async function queryListings({ env, store }: Ctx, q: ListingQuery): Promise<Listing[]> {
  const where = [visibleWhere(store)];
  const args: unknown[] = [store.id];
  const add = (sql: string, v: unknown) => (where.push(sql), args.push(v));
  if (q.category) add('l.category = ?', q.category);
  if (q.model_id) add('l.model_id = ?', q.model_id);
  if (q.storage) add('l.storage_gb = ?', q.storage);
  if (q.price_min) add('l.price >= ?', q.price_min);
  if (q.price_max) add('l.price <= ?', q.price_max);
  if (q.battery_min) add('l.battery_pct >= ?', q.battery_min);
  if (q.condition) add('l.condition = ?', q.condition);
  if (q.sim === 'physical') where.push('l.physical_sim = 1');
  if (q.sim === 'esim') where.push('l.physical_sim = 0');
  const order =
    {
      new: 'l.created_at DESC',
      cheap: 'l.price ASC',
      expensive: 'l.price DESC',
      battery: 'l.battery_pct DESC',
    }[q.sort ?? 'new'] ?? 'l.created_at DESC';
  const { results } = await env.DB.prepare(`${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`)
    .bind(...args)
    .all<ListingRow>();
  return results.map(toListing);
}

export async function getListing({ env, store }: Ctx, id: number): Promise<Listing | null> {
  const row = await env.DB.prepare(`${LISTING_SELECT} WHERE l.id = ? AND l.store_id = ?`).bind(id, store.id).first<ListingRow>();
  if (!row) return null;
  const listing = toListing(row);
  // галерея и видео проксируются из Telegram; видео больше 20 МБ Bot API не отдаёт — оно остаётся в посте
  const { results } = await env.DB.prepare(
    `SELECT id, kind, source, poster_source, file_size, width, height, position FROM media WHERE listing_id = ? ORDER BY position, kind`,
  )
    .bind(id)
    .all<{ id: number; kind: 'photo' | 'video'; source: string; poster_source: string | null; file_size: number | null; width: number | null; height: number | null; position: number }>();
  listing.media = results
    .filter((m) => !(m.source.startsWith('tg:') && m.file_size && m.file_size > TG_FILE_LIMIT))
    .map(
      (m): MediaItem => ({
        id: m.id,
        kind: m.kind,
        url: `/media/i/${m.id}`,
        poster: m.poster_source ? `/media/i/${m.id}?v=poster` : null,
        width: m.width,
        height: m.height,
        position: m.position,
      }),
    );
  return listing;
}

export async function getListingRow({ env, store }: Ctx, id: number) {
  return env.DB.prepare('SELECT * FROM listings WHERE id = ? AND store_id = ?').bind(id, store.id).first<ListingRow>();
}

export async function getFacets(ctx: Ctx): Promise<Facets> {
  const { env, store } = ctx;
  const vis = visibleWhere(store);
  const models = await env.DB.prepare(
    `SELECT l.model_id, l.line, l.short, l.title, l.category, COUNT(*) AS count, MIN(l.price) AS min_price FROM listings l
     WHERE ${vis} AND l.model_id IS NOT NULL GROUP BY l.model_id`,
  )
    .bind(store.id)
    .all<ModelFacet>();
  const agg = await env.DB.prepare(`SELECT COUNT(*) AS total, MIN(l.price) AS pmin, MAX(l.price) AS pmax FROM listings l WHERE ${vis}`)
    .bind(store.id)
    .first<{ total: number; pmin: number | null; pmax: number | null }>();
  const cats = await env.DB.prepare(`SELECT l.category, COUNT(*) AS count FROM listings l WHERE ${vis} GROUP BY l.category ORDER BY count DESC`)
    .bind(store.id)
    .all<{ category: Category; count: number }>();
  const st = await env.DB.prepare(`SELECT DISTINCT l.storage_gb FROM listings l WHERE ${vis} AND l.storage_gb IS NOT NULL ORDER BY l.storage_gb`)
    .bind(store.id)
    .all<{ storage_gb: number }>();
  const cond = await env.DB.prepare(
    `SELECT l.condition, COUNT(*) AS c FROM listings l WHERE ${vis} AND l.condition IS NOT NULL GROUP BY l.condition ORDER BY c DESC`,
  )
    .bind(store.id)
    .all<{ condition: string }>();
  const synced = await env.DB.prepare('SELECT MAX(updated_at) AS t FROM listings WHERE store_id = ?').bind(store.id).first<{ t: number | null }>();
  const sorted = models.results.sort((a, b) => modelRank(b) - modelRank(a));
  return {
    total: agg?.total ?? 0,
    categories: cats.results.map((c) => ({ ...c, title: CATEGORIES[c.category]?.title ?? c.category })),
    models: sorted,
    storages: st.results.map((r) => r.storage_gb),
    conditions: cond.results.map((r) => r.condition),
    price_min: agg?.pmin ?? 0,
    price_max: agg?.pmax ?? 0,
    synced_at: synced?.t ?? null,
  };
}

const CATEGORY_ORDER: Category[] = ['phone', 'computer', 'tablet', 'watch', 'audio', 'console', 'other'];

/** Внутри категории — от новых моделей к старым: 17 Pro Max выше 17 Pro выше 17 выше 16 Pro Max */
export function modelRank(m: { category: Category; short: string; line: string }): number {
  const cat = (CATEGORY_ORDER.length - CATEGORY_ORDER.indexOf(m.category)) * 10_000;
  const num = parseFloat(m.short.replace(/^[A-Za-z ]*?(?=\d)/, ''));
  const base = Number.isFinite(num) ? num * 10 : ({ XS: 85, XR: 84, X: 83, SE: 50 } as Record<string, number>)[m.short.split(' ')[0]] ?? 0;
  const v = m.short.replace(/^\S+\s*/, '');
  const bonus = ({ 'Pro Max': 4, Ultra: 4, Pro: 3, Air: 2.5, Plus: 2, '': 1, mini: 0.5, Max: 4 } as Record<string, number>)[v] ?? 0;
  return cat + base + bonus - (/\de\b/.test(m.short) ? 0.5 : 0);
}

export async function logEvent(
  { env, store }: Ctx,
  type: string,
  userId: number | null,
  extra: { listing_id?: number | null; model_id?: string | null; meta?: unknown } = {},
) {
  await env.DB.prepare('INSERT INTO events (store_id, tg_user_id, type, listing_id, model_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(store.id, userId, type, extra.listing_id ?? null, extra.model_id ?? null, extra.meta ? JSON.stringify(extra.meta) : null, now())
    .run();
}

export async function upsertUser({ env }: Ctx, u: { id: number; username?: string; first_name?: string }) {
  await env.DB.prepare(
    `INSERT INTO users (tg_user_id, username, first_name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (tg_user_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, updated_at = excluded.updated_at`,
  )
    .bind(u.id, u.username ?? null, u.first_name ?? null, now())
    .run();
}

export async function listSubscriptions({ env, store }: Ctx, userId: number): Promise<Subscription[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.model_id, s.title, s.storage_gb, s.max_price, s.created_at
     FROM subscriptions s WHERE s.store_id = ? AND s.tg_user_id = ? AND s.active = 1 ORDER BY s.created_at DESC`,
  )
    .bind(store.id, userId)
    .all<Subscription>();
  return results;
}

/** Избранное покупателя: и проданные тоже — чтобы было видно, что ушло */
export async function listFavorites({ env, store }: Ctx, userId: number): Promise<Listing[]> {
  const { results } = await env.DB.prepare(
    `${LISTING_SELECT} JOIN favorites f ON f.listing_id = l.id AND f.store_id = l.store_id
     WHERE l.store_id = ? AND f.tg_user_id = ? AND l.status != 'hidden' ORDER BY f.created_at DESC`,
  )
    .bind(store.id, userId)
    .all<ListingRow>();
  return results.map(toListing);
}
