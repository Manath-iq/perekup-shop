import type { Facets, Listing, MediaItem, Subscription } from '@vitrina/core/types';
import type { Env } from './env';

export interface ListingRow {
  id: number;
  source_channel: string;
  channel_msg_id: number;
  media_group_id: string | null;
  category: string;
  model_raw: string | null;
  family: string | null;
  storage_gb: number | null;
  condition: string | null;
  sim: string | null;
  has_physical_sim: number | null;
  battery_pct: number | null;
  battery_cycles: number | null;
  ios: string | null;
  pluses: string;
  nuances: string;
  kit: string | null;
  full_kit: number;
  price_rub: number | null;
  status: 'active' | 'sold' | 'hidden';
  parse_ok: number;
  confirmed: number;
  raw_text: string;
  post_url: string;
  created_at: number;
  updated_at: number;
  sold_at: number | null;
}

export const mediaUrl = (key: string) => `/media/${key}`;

export function toListing(r: ListingRow & { cover_key?: string | null; old_price?: number | null }): Listing {
  return {
    id: r.id,
    channel_msg_id: r.channel_msg_id,
    family: r.family,
    model_raw: r.model_raw,
    storage_gb: r.storage_gb,
    condition: r.condition,
    sim: r.sim,
    has_physical_sim: r.has_physical_sim === null ? null : !!r.has_physical_sim,
    battery_pct: r.battery_pct,
    battery_cycles: r.battery_cycles,
    ios: r.ios,
    pluses: JSON.parse(r.pluses),
    nuances: JSON.parse(r.nuances),
    kit: r.kit,
    full_kit: !!r.full_kit,
    price_rub: r.price_rub,
    old_price_rub: r.old_price && r.price_rub && r.old_price > r.price_rub ? r.old_price : null,
    status: r.status,
    post_url: r.post_url,
    created_at: r.created_at,
    cover: r.cover_key ? mediaUrl(r.cover_key) : null,
  };
}

const LISTING_SELECT = `
  SELECT l.*,
    (SELECT storage_key FROM media m WHERE m.listing_id = l.id AND m.kind = 'photo'
       AND m.storage_key IS NOT NULL AND m.storage_key != 'skip' ORDER BY position LIMIT 1) AS cover_key,
    (SELECT price_rub FROM price_history p WHERE p.listing_id = l.id ORDER BY changed_at DESC LIMIT 1) AS old_price
  FROM listings l`;

export interface ListingQuery {
  family?: string;
  storage?: number;
  price_min?: number;
  price_max?: number;
  battery_min?: number;
  condition?: string;
  sim?: 'physical' | 'esim';
  sort?: 'new' | 'cheap' | 'expensive' | 'battery';
}

export async function queryListings(env: Env, q: ListingQuery): Promise<Listing[]> {
  const where = [`l.status = 'active'`];
  const args: unknown[] = [];
  if (q.family) (where.push('l.family = ?'), args.push(q.family));
  if (q.storage) (where.push('l.storage_gb = ?'), args.push(q.storage));
  if (q.price_min) (where.push('l.price_rub >= ?'), args.push(q.price_min));
  if (q.price_max) (where.push('l.price_rub <= ?'), args.push(q.price_max));
  if (q.battery_min) (where.push('l.battery_pct >= ?'), args.push(q.battery_min));
  if (q.condition) (where.push('l.condition = ?'), args.push(q.condition));
  if (q.sim === 'physical') where.push('l.has_physical_sim = 1');
  if (q.sim === 'esim') where.push('l.has_physical_sim = 0');
  const order = {
    new: 'l.created_at DESC',
    cheap: 'l.price_rub ASC',
    expensive: 'l.price_rub DESC',
    battery: 'l.battery_pct DESC',
  }[q.sort ?? 'new'] ?? 'l.created_at DESC';
  const { results } = await env.DB.prepare(`${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`)
    .bind(...args)
    .all<ListingRow>();
  return results.map(toListing);
}

export async function getListing(env: Env, id: number): Promise<Listing | null> {
  const row = await env.DB.prepare(`${LISTING_SELECT} WHERE l.id = ?`).bind(id).first<ListingRow>();
  if (!row) return null;
  const listing = toListing(row);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, storage_key, width, height, position FROM media
     WHERE listing_id = ? AND storage_key IS NOT NULL AND storage_key != 'skip' ORDER BY position`,
  )
    .bind(id)
    .all<{ id: number; kind: 'photo' | 'video'; storage_key: string; width: number | null; height: number | null; position: number }>();
  listing.media = results.map(
    (m): MediaItem => ({ id: m.id, kind: m.kind, url: mediaUrl(m.storage_key), width: m.width, height: m.height, position: m.position }),
  );
  return listing;
}

export async function getListingRow(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first<ListingRow>();
}

export async function getFacets(env: Env): Promise<Facets> {
  const fam = await env.DB.prepare(
    `SELECT family, COUNT(*) AS count, MAX(created_at) AS latest FROM listings
     WHERE status = 'active' AND family IS NOT NULL GROUP BY family`,
  ).all<{ family: string; count: number }>();
  const agg = await env.DB.prepare(
    `SELECT COUNT(*) AS total, MIN(price_rub) AS pmin, MAX(price_rub) AS pmax FROM listings WHERE status = 'active'`,
  ).first<{ total: number; pmin: number | null; pmax: number | null }>();
  const st = await env.DB.prepare(
    `SELECT DISTINCT storage_gb FROM listings WHERE status = 'active' AND storage_gb IS NOT NULL ORDER BY storage_gb`,
  ).all<{ storage_gb: number }>();
  const cond = await env.DB.prepare(
    `SELECT condition, COUNT(*) AS c FROM listings WHERE status = 'active' AND condition IS NOT NULL GROUP BY condition ORDER BY c DESC`,
  ).all<{ condition: string }>();
  return {
    total: agg?.total ?? 0,
    families: fam.results.sort((a, b) => familyRank(b.family) - familyRank(a.family)),
    storages: st.results.map((r) => r.storage_gb),
    conditions: cond.results.map((r) => r.condition),
    price_min: agg?.pmin ?? 0,
    price_max: agg?.pmax ?? 0,
  };
}

/** 17 Pro Max выше 17 Pro выше 17 выше 16 Pro Max … — чтобы чипы шли от новых к старым */
export function familyRank(f: string): number {
  const num = parseInt(f, 10);
  const base = Number.isFinite(num) ? num * 10 : { XS: 85, XR: 84, X: 83, SE: 50 }[f.split(' ')[0]] ?? 0;
  const v = f.replace(/^\S+\s*/, '');
  const bonus = { 'Pro Max': 4, Pro: 3, Air: 2.5, Plus: 2, '': 1, mini: 0.5, Max: 4 }[v] ?? 0;
  return base + bonus - (/\de\b/.test(f) ? 0.5 : 0);
}

export async function logEvent(env: Env, type: string, userId: number | null, listingId: number | null = null) {
  await env.DB.prepare('INSERT INTO events (tg_user_id, type, listing_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, type, listingId, Math.floor(Date.now() / 1000))
    .run();
}

export async function upsertUser(env: Env, u: { id: number; username?: string; first_name?: string }) {
  await env.DB.prepare(
    `INSERT INTO users (tg_user_id, username, first_name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (tg_user_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, updated_at = excluded.updated_at`,
  )
    .bind(u.id, u.username ?? null, u.first_name ?? null, Math.floor(Date.now() / 1000))
    .run();
}

export async function listSubscriptions(env: Env, userId: number): Promise<Subscription[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, family, storage_gb, max_price, created_at FROM subscriptions WHERE tg_user_id = ? AND active = 1 ORDER BY created_at DESC',
  )
    .bind(userId)
    .all<Subscription>();
  return results;
}
