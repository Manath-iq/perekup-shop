import { parseItems, type ParsedItem, type ParseResult } from '@vitrina/core/parse';
import type { ListingStatus } from '@vitrina/core/types';
import type { Ctx } from './store';
import { now } from './env';
import type { ListingRow } from './db';
import { BLUR_LIMIT, fetchSource, kvMediaStore, refreshFeedSource } from './media';
import { llmFallback } from './llm';

export interface IncomingPost {
  msg_id: number;
  text: string;
  media_group_id: string | null;
  date: number;
  post_url: string;
}

export interface UpsertResult {
  listing: ListingRow;
  parsed: ParseResult;
  created: boolean;
  becameSold: boolean;
  priceChanged: boolean;
  /** Цена до правки поста — для уведомления о снижении */
  oldPrice: number | null;
}

export interface UpsertOptions {
  /** Перепарсить, даже если текст не менялся (после правки профиля) */
  force?: boolean;
  /** Разрешить запрос к Gemini. Перепарсинг всей истории идёт без него — только кэш */
  llm?: boolean;
}

/**
 * Сохранить пост и создать или обновить карточки по его тексту: обычно одну, у поста-прайса — по строке на товар.
 * Исходный текст пишется всегда — по нему можно перепарсить всё после улучшения разбора.
 */
export async function upsertPost(ctx: Ctx, post: IncomingPost, opts: UpsertOptions = {}): Promise<UpsertResult[]> {
  const { env, store } = ctx;
  const ts = now();
  const prev = await env.DB.prepare('SELECT text FROM posts WHERE store_id = ? AND msg_id = ?')
    .bind(store.id, post.msg_id)
    .first<{ text: string }>();
  await env.DB.prepare(
    `INSERT INTO posts (store_id, msg_id, media_group_id, text, post_url, date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id, msg_id) DO UPDATE SET text = excluded.text, media_group_id = COALESCE(excluded.media_group_id, posts.media_group_id),
       updated_at = excluded.updated_at, deleted = 0`,
  )
    .bind(store.id, post.msg_id, post.media_group_id, post.text, post.post_url, post.date || ts, ts)
    .run();

  const { results: existingRows } = await env.DB.prepare('SELECT * FROM listings WHERE store_id = ? AND msg_id = ? ORDER BY item')
    .bind(store.id, post.msg_id)
    .all<ListingRow>();
  if (existingRows.length && prev?.text === post.text && !opts.force) return [];

  let items = parseItems(post.text, store.profile);
  // Gemini — только для обычного поста: строки прайса короткие и разбираются правилами
  if (items.length === 1 && items[0].item === 0 && !items[0].parse_ok && items[0].status !== 'not_listing') {
    items = [{ ...(await llmFallback(env, post.text, items[0], opts.llm ?? true)), item: 0 }];
  }
  // у продавца без отметок «продано» старое объявление само по себе устаревает
  const { mode, staleDays } = store.profile;
  const stale = mode === 'unless_sold' && staleDays > 0 && (post.date || ts) < ts - staleDays * 86400;

  const out: UpsertResult[] = [];
  for (const p of items) {
    const existing = existingRows.find((r) => r.item === p.item);
    const r = await upsertItem(ctx, post, p, existing, stale);
    if (r) out.push(r);
  }

  // строк, которых больше нет в прайсе, нет и в наличии
  for (const r of existingRows) {
    if (!items.some((i) => i.item === r.item) && (r.status === 'active' || r.status === 'reserved')) await setStatus(ctx, r.id, 'sold');
  }
  // новый прайс заменяет старые: их товары, которых продавец больше не перечисляет, сняты
  if (items.some((i) => i.item > 0)) {
    await env.DB.prepare(
      `UPDATE listings SET status = 'sold', sold_at = ?, updated_at = ? WHERE store_id = ? AND item > 0 AND msg_id < ? AND status IN ('active', 'reserved')`,
    )
      .bind(ts, ts, store.id, post.msg_id)
      .run();
  }
  return out;
}

async function upsertItem(ctx: Ctx, post: IncomingPost, p: ParsedItem, existing: ListingRow | undefined, stale: boolean): Promise<UpsertResult | null> {
  const { env, store } = ctx;
  const ts = now();
  const live = (p.status === 'active' || p.status === 'reserved') && !stale;

  if (!existing) {
    // проданное, устаревшее и не-объявления без карточки — только в posts
    if (!live) return null;
    const row = await env.DB.prepare(
      `INSERT INTO listings (store_id, msg_id, item, media_group_id, ${LISTING_COLS.join(', ')}, status, post_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ${LISTING_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)
       ON CONFLICT (store_id, msg_id, item) DO UPDATE SET updated_at = excluded.updated_at
       RETURNING *`,
    )
      .bind(store.id, post.msg_id, p.item, post.media_group_id, ...listingValues(p), p.status, post.post_url, post.date || ts, ts)
      .first<ListingRow>();
    if (!row) return null;
    await attachGroupMedia(ctx, row);
    return { listing: row, parsed: p, created: true, becameSold: false, priceChanged: false, oldPrice: null };
  }

  // Правка поста: «Продано» → sold, снова в наличии → active. Скрытые вручную остаются скрытыми.
  let status: ListingStatus = existing.status;
  if (status !== 'hidden') status = live ? (p.status as ListingStatus) : 'sold';
  const becameSold = existing.status !== 'sold' && status === 'sold';
  const priceChanged = !!p.price && !!existing.price && p.price !== existing.price;
  if (priceChanged) {
    await env.DB.prepare('INSERT INTO price_history (listing_id, price, changed_at) VALUES (?, ?, ?)').bind(existing.id, existing.price, ts).run();
  }
  // Найденное раньше не теряем, если новая версия поста разобралась хуже (например, «Продано» без текста)
  const keep = p.status === 'not_listing';
  const row = await env.DB.prepare(
    `UPDATE listings SET ${keep ? '' : LISTING_COLS.map((c) => `${c} = ?`).join(', ') + ','} status = ?, updated_at = ?,
       sold_at = CASE WHEN ? = 'sold' AND sold_at IS NULL THEN ? WHEN ? != 'sold' THEN NULL ELSE sold_at END
     WHERE id = ? RETURNING *`,
  )
    .bind(...(keep ? [] : listingValues(p)), status, ts, status, ts, status, existing.id)
    .first<ListingRow>();
  return row ? { listing: row, parsed: p, created: false, becameSold, priceChanged, oldPrice: existing.price } : null;
}

/** Объявления старше staleDays у продавцов без отметок «продано» — сняты; раз в час */
export async function retireStale({ env, store }: Ctx) {
  const { mode, staleDays } = store.profile;
  if (mode !== 'unless_sold' || !staleDays) return { retired: 0 };
  const ts = now();
  const r = await env.DB.prepare(`UPDATE listings SET status = 'sold', sold_at = ?, updated_at = ? WHERE store_id = ? AND status = 'active' AND created_at < ?`)
    .bind(ts, ts, store.id, ts - staleDays * 86400)
    .run();
  return { retired: r.meta.changes ?? 0 };
}

const LISTING_COLS = [
  'category', 'brand', 'model_id', 'line', 'short', 'title', 'price', 'storage_gb', 'battery_pct', 'condition', 'physical_sim',
  'attrs', 'pluses', 'nuances', 'confidence', 'parse_ok', 'parsed_by',
];

function listingValues(p: ParseResult) {
  const a = p.attrs;
  return [
    p.category, p.model?.brand ?? null, p.model?.id ?? null, p.model?.line ?? null, p.model?.short ?? null, p.title ?? 'Товар', p.price,
    a.storage_gb ?? null, a.battery_pct ?? null, a.condition ?? null, a.physical_sim === undefined ? null : +a.physical_sim,
    JSON.stringify(a), JSON.stringify(p.pluses), JSON.stringify(p.nuances), p.confidence, +p.parse_ok,
    p.source,
  ];
}

export async function setStatus({ env, store }: Ctx, id: number, status: ListingStatus) {
  return env.DB.prepare(
    `UPDATE listings SET status = ?, updated_at = ?, sold_at = CASE WHEN ? = 'sold' THEN ? ELSE sold_at END WHERE id = ? AND store_id = ? RETURNING *`,
  )
    .bind(status, now(), status, now(), id, store.id)
    .first<ListingRow>();
}

/** Перепарсить сохранённые посты порцией — после правки профиля или улучшения движка */
export async function reparse(ctx: Ctx, offset = 0, limit = 25) {
  const { results } = await ctx.env.DB.prepare(
    'SELECT msg_id, text, media_group_id, post_url, date FROM posts WHERE store_id = ? AND deleted = 0 ORDER BY msg_id LIMIT ? OFFSET ?',
  )
    .bind(ctx.store.id, limit, offset)
    .all<IncomingPost>();
  let created = 0;
  let updated = 0;
  for (const post of results) {
    for (const r of await upsertPost(ctx, post, { force: true, llm: false })) {
      if (r.created) created++;
      else updated++;
    }
  }
  return { processed: results.length, created, updated, next: results.length === limit ? offset + limit : null };
}

export interface IncomingMedia {
  msg_id: number;
  media_group_id: string | null;
  kind: 'photo' | 'video';
  /** Файл для галереи: 'tg:<file_id>' для Bot API или https-ссылка CDN для импорта */
  source: string;
  /** Размер фото для обложки (~800 px); у импорта не бывает — берётся source */
  cover_source?: string | null;
  /** Самый маленький размер фото — для размытого превью */
  blur_source?: string | null;
  /** Кадр-превью видео */
  poster_source?: string | null;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Регистрирует файл альбома. Фото и подпись приходят разными апдейтами в любом порядке, поэтому файл
 * сначала пишется «ничейным», а потом привязывается к карточке по media_group_id — с обеих сторон.
 */
export async function addMedia(ctx: Ctx, m: IncomingMedia): Promise<number | null> {
  const { env, store } = ctx;
  await env.DB.prepare(
    `INSERT INTO media (store_id, media_group_id, msg_id, kind, source, cover_source, blur_source, poster_source, file_size, width, height, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id, msg_id, kind) DO UPDATE SET source = excluded.source, cover_source = excluded.cover_source,
       blur_source = excluded.blur_source, poster_source = COALESCE(excluded.poster_source, media.poster_source)`,
  )
    .bind(
      store.id, m.media_group_id, m.msg_id, m.kind, m.source, m.cover_source ?? null, m.blur_source ?? null, m.poster_source ?? null,
      m.file_size ?? null, m.width ?? null, m.height ?? null, m.msg_id, now(),
    )
    .run();
  const listing = await env.DB.prepare(
    `SELECT * FROM listings WHERE store_id = ? AND (msg_id = ? OR (media_group_id IS NOT NULL AND media_group_id = ?))`,
  )
    .bind(store.id, m.msg_id, m.media_group_id)
    .first<ListingRow>();
  if (!listing) return null;
  await attachGroupMedia(ctx, listing);
  return listing.id;
}

async function attachGroupMedia({ env }: Ctx, l: ListingRow) {
  await env.DB.prepare(
    `UPDATE media SET listing_id = ? WHERE listing_id IS NULL AND store_id = ?
       AND (msg_id = ? OR (media_group_id IS NOT NULL AND media_group_id = ?))`,
  )
    .bind(l.id, l.store_id, l.msg_id, l.media_group_id)
    .run();
}

interface CoverCandidate {
  listing_id: number;
  id: number;
  msg_id: number;
  kind: 'photo' | 'video';
  source: string;
  cover_source: string | null;
  blur_source: string | null;
  poster_source: string | null;
}

const toBase64 = (buf: ArrayBuffer) => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Обложки карточек в наличии — в KV, одна запись на карточку. Берётся первое фото альбома
 * (или кадр видео, если фото нет) плюс крошечное превью для размытой подложки, пока грузится обложка.
 * limit держит число подзапросов в лимите бесплатного Workers (50 на вызов).
 */
export async function downloadCovers({ env, store }: Ctx, limit = 10): Promise<{ done: number; remaining: number }> {
  const pick = `SELECT id FROM media WHERE listing_id = l.id ORDER BY (kind = 'photo') DESC, position LIMIT 1`;
  const { results } = await env.DB.prepare(
    `SELECT l.id AS listing_id, m.id, m.msg_id, m.kind, m.source, m.cover_source, m.blur_source, m.poster_source
     FROM listings l JOIN media m ON m.id = (${pick})
     WHERE l.store_id = ? AND l.status IN ('active', 'reserved') AND m.storage_key IS NULL
     ORDER BY l.id DESC LIMIT ?`,
  )
    .bind(store.id, limit)
    .all<CoverCandidate>();
  const kv = kvMediaStore(env);
  let done = 0;
  for (const m of results) {
    const key = `c/${store.id.replace(/[^\w-]/g, '')}/${m.listing_id}`;
    let stored = 'skip';
    let blur: string | null = null;
    try {
      let src = m.kind === 'photo' ? (m.cover_source ?? m.source) : m.poster_source;
      if (!src) throw new Error('no cover source');
      let res = await fetchSource(env, src);
      if (!res && !src.startsWith('tg:')) {
        const fresh = await refreshFeedSource(env, { id: m.id, msg_id: m.msg_id, kind: m.kind, channel: store.channel });
        src = (m.kind === 'photo' ? fresh?.source : fresh?.poster) ?? null;
        res = src ? await fetchSource(env, src) : null;
      }
      if (!res) throw new Error('cover fetch failed');
      await kv.put(key, await res.arrayBuffer(), res.headers.get('content-type')?.startsWith('image/') ? res.headers.get('content-type')! : 'image/jpeg');
      stored = key;
      done++;
      if (m.blur_source) {
        const b = await fetchSource(env, m.blur_source);
        const buf = b ? await b.arrayBuffer() : null;
        if (buf && buf.byteLength * 1.37 <= BLUR_LIMIT) blur = `data:image/jpeg;base64,${toBase64(buf)}`;
      }
    } catch (e) {
      // без обложки карточка всё равно видна — мини-апп покажет заглушку и галерею
      console.warn('cover skipped', m.id, String(e));
    }
    await env.DB.prepare('UPDATE media SET storage_key = ?, blur = COALESCE(?, blur) WHERE id = ?').bind(stored, blur, m.id).run();
  }
  const rest = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM listings l JOIN media m ON m.id = (${pick})
     WHERE l.store_id = ? AND l.status IN ('active', 'reserved') AND m.storage_key IS NULL`,
  )
    .bind(store.id)
    .first<{ c: number }>();
  return { done, remaining: rest?.c ?? 0 };
}

/**
 * Удаляет из KV обложки карточек, проданных больше days дней назад. Галерея и видео не хранятся, чистить больше нечего.
 * storage_key сбрасывается в NULL: если пост снова станет актуальным, обложка скачается заново.
 * limit держит число удалений в бесплатном лимите KV (1000 записей в день, удаление считается записью).
 */
export async function purgeSoldMedia({ env, store }: Ctx, days = 7, limit = 20): Promise<{ deleted: number }> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.storage_key FROM media m JOIN listings l ON l.id = m.listing_id
     WHERE m.store_id = ? AND l.status = 'sold' AND l.sold_at < ? AND m.storage_key IS NOT NULL AND m.storage_key != 'skip'
     LIMIT ?`,
  )
    .bind(store.id, now() - days * 86400, limit)
    .all<{ id: number; storage_key: string }>();
  const kv = kvMediaStore(env);
  for (const m of results) {
    await kv.delete(m.storage_key);
    await env.DB.prepare('UPDATE media SET storage_key = NULL WHERE id = ?').bind(m.id).run();
  }
  return { deleted: results.length };
}
