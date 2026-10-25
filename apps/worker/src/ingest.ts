import { isListingPost, parsePost } from '@vitrina/core/parser';
import type { Env } from './env';
import { now } from './env';
import type { ListingRow } from './db';
import { kvMediaStore, TG_FILE_LIMIT } from './media';
import { llmFallback } from './llm';

export interface IncomingPost {
  channel: string;
  msg_id: number;
  text: string;
  media_group_id: string | null;
  date: number;
  post_url: string;
}

export interface UpsertResult {
  listing: ListingRow;
  created: boolean;
  becameSold: boolean;
  priceChanged: boolean;
}

/** Создать или обновить карточку по тексту поста. Посты без хэштега, которых ещё нет в базе, игнорируются. */
export async function upsertPost(env: Env, post: IncomingPost): Promise<UpsertResult | null> {
  const existing = await env.DB.prepare('SELECT * FROM listings WHERE source_channel = ? AND channel_msg_id = ?')
    .bind(post.channel, post.msg_id)
    .first<ListingRow>();
  if (!existing && !isListingPost(post.text)) return null;

  let p = parsePost(post.text);
  if (!p.parse_ok && isListingPost(post.text) && (!existing || existing.raw_text !== post.text)) {
    p = await llmFallback(env, post.text, p);
  }
  const ts = now();

  if (!existing) {
    const row = await env.DB.prepare(
      `INSERT INTO listings (source_channel, channel_msg_id, media_group_id, category, model_raw, family, storage_gb,
        condition, sim, has_physical_sim, battery_pct, battery_cycles, ios, pluses, nuances, kit, full_kit, price_rub,
        status, parse_ok, raw_text, post_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_channel, channel_msg_id) DO UPDATE SET updated_at = excluded.updated_at
       RETURNING *`,
    )
      .bind(
        post.channel, post.msg_id, post.media_group_id, p.category, p.model_raw, p.family, p.storage_gb,
        p.condition, p.sim, p.has_physical_sim === null ? null : +p.has_physical_sim, p.battery_pct, p.battery_cycles,
        p.ios, JSON.stringify(p.pluses), JSON.stringify(p.nuances), p.kit, +p.full_kit, p.price_rub,
        p.status, +p.parse_ok, post.text, post.post_url, post.date || ts, ts,
      )
      .first<ListingRow>();
    if (!row) return null;
    await attachGroupMedia(env, row);
    return { listing: row, created: true, becameSold: false, priceChanged: false };
  }

  // Правка поста: продавец меняет хэштег на «Продано» → sold. Скрытые вручную остаются скрытыми.
  let status = existing.status;
  if (p.status === 'sold' && status === 'active') status = 'sold';
  if (p.status === 'active' && status === 'sold') status = 'active';
  const becameSold = existing.status === 'active' && status === 'sold';
  const priceChanged = !!p.price_rub && !!existing.price_rub && p.price_rub !== existing.price_rub;
  if (priceChanged) {
    await env.DB.prepare('INSERT INTO price_history (listing_id, price_rub, changed_at) VALUES (?, ?, ?)')
      .bind(existing.id, existing.price_rub, ts)
      .run();
  }
  const row = await env.DB.prepare(
    `UPDATE listings SET model_raw = ?, family = ?, storage_gb = ?, condition = ?, sim = ?, has_physical_sim = ?,
       battery_pct = ?, battery_cycles = ?, ios = ?, pluses = ?, nuances = ?, kit = ?, full_kit = ?, price_rub = ?,
       status = ?, parse_ok = ?, raw_text = ?, updated_at = ?,
       sold_at = CASE WHEN ? = 'sold' AND sold_at IS NULL THEN ? WHEN ? = 'active' THEN NULL ELSE sold_at END
     WHERE id = ? RETURNING *`,
  )
    .bind(
      p.model_raw ?? existing.model_raw, p.family ?? existing.family, p.storage_gb ?? existing.storage_gb,
      p.condition, p.sim, p.has_physical_sim === null ? null : +p.has_physical_sim, p.battery_pct, p.battery_cycles,
      p.ios, JSON.stringify(p.pluses), JSON.stringify(p.nuances), p.kit, +p.full_kit, p.price_rub ?? existing.price_rub,
      status, +p.parse_ok, post.text, ts, status, ts, status, existing.id,
    )
    .first<ListingRow>();
  return row ? { listing: row, created: false, becameSold, priceChanged } : null;
}

export async function setStatus(env: Env, id: number, status: 'active' | 'sold' | 'hidden') {
  return env.DB.prepare(
    `UPDATE listings SET status = ?, updated_at = ?, sold_at = CASE WHEN ? = 'sold' THEN ? ELSE sold_at END WHERE id = ? RETURNING *`,
  )
    .bind(status, now(), status, now(), id)
    .first<ListingRow>();
}

export interface IncomingMedia {
  channel: string;
  msg_id: number;
  media_group_id: string | null;
  kind: 'photo' | 'video';
  /** 'tg:<file_id>' для Bot API или https-ссылка CDN для импорта */
  source: string;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Регистрирует файл альбома. Фото и подпись приходят разными апдейтами в любом порядке, поэтому файл
 * сначала пишется «ничейным», а потом привязывается к карточке по media_group_id — с обеих сторон.
 */
export async function addMedia(env: Env, m: IncomingMedia): Promise<number | null> {
  await env.DB.prepare(
    `INSERT INTO media (source_channel, media_group_id, msg_id, kind, source, file_size, width, height, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_channel, msg_id, kind) DO UPDATE SET source = excluded.source`,
  )
    .bind(m.channel, m.media_group_id, m.msg_id, m.kind, m.source, m.file_size ?? null, m.width ?? null, m.height ?? null, m.msg_id, now())
    .run();
  const listing = await env.DB.prepare(
    `SELECT * FROM listings WHERE source_channel = ? AND (channel_msg_id = ? OR (media_group_id IS NOT NULL AND media_group_id = ?))`,
  )
    .bind(m.channel, m.msg_id, m.media_group_id)
    .first<ListingRow>();
  if (!listing) return null;
  await attachGroupMedia(env, listing);
  return listing.id;
}

async function attachGroupMedia(env: Env, l: ListingRow) {
  await env.DB.prepare(
    `UPDATE media SET listing_id = ? WHERE listing_id IS NULL AND source_channel = ?
       AND (msg_id = ? OR (media_group_id IS NOT NULL AND media_group_id = ?))`,
  )
    .bind(l.id, l.source_channel, l.channel_msg_id, l.media_group_id)
    .run();
}

/** Скачать в хранилище файлы привязанных карточек. limit — чтобы уложиться в лимит подзапросов воркера. */
export async function downloadPending(env: Env, limit = 30): Promise<{ done: number; remaining: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, source_channel, msg_id, kind, source, file_size FROM media
     WHERE listing_id IS NOT NULL AND storage_key IS NULL AND listing_id NOT IN (SELECT id FROM listings WHERE status = 'sold')
     ORDER BY listing_id DESC, position LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: number; source_channel: string; msg_id: number; kind: 'photo' | 'video'; source: string; file_size: number | null }>();
  const store = kvMediaStore(env);
  let done = 0;
  for (const m of results) {
    const key = `m/${m.source_channel.replace(/[^\w-]/g, '')}/${m.msg_id}-${m.kind}`;
    let stored: string = 'skip';
    try {
      if (m.file_size && m.file_size > TG_FILE_LIMIT) throw new Error('too big');
      let url = m.source;
      if (m.source.startsWith('tg:')) {
        const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${m.source.slice(3)}`);
        const j = (await r.json()) as { ok: boolean; result?: { file_path: string } };
        if (!j.ok || !j.result) throw new Error('getFile failed');
        url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${j.result.file_path}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const len = +(res.headers.get('content-length') ?? 0);
      if (len > TG_FILE_LIMIT) throw new Error('too big');
      const body = await res.arrayBuffer();
      await store.put(key, body, m.kind === 'video' ? 'video/mp4' : res.headers.get('content-type') || 'image/jpeg');
      stored = key;
      done++;
    } catch (e) {
      // видео больше лимита и битые файлы пропускаем — в карточке есть ссылка на пост
      console.warn('media skipped', m.id, String(e));
    }
    await env.DB.prepare('UPDATE media SET storage_key = ? WHERE id = ?').bind(stored, m.id).run();
  }
  const rest = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM media WHERE listing_id IS NOT NULL AND storage_key IS NULL
       AND listing_id NOT IN (SELECT id FROM listings WHERE status = 'sold')`,
  ).first<{ c: number }>();
  return { done, remaining: rest?.c ?? 0 };
}

/**
 * Удаляет из хранилища фото и видео карточек, проданных больше days дней назад, чтобы KV не переполнялся.
 * storage_key сбрасывается в NULL: если пост снова станет актуальным, файлы скачаются заново по file_id.
 * limit держит число удалений в бесплатном лимите KV (1000 записей в день, удаление считается записью).
 */
export async function purgeSoldMedia(env: Env, days = 7, limit = 20): Promise<{ deleted: number }> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.storage_key FROM media m JOIN listings l ON l.id = m.listing_id
     WHERE l.status = 'sold' AND l.sold_at < ? AND m.storage_key IS NOT NULL AND m.storage_key != 'skip'
     LIMIT ?`,
  )
    .bind(now() - days * 86400, limit)
    .all<{ id: number; storage_key: string }>();
  const store = kvMediaStore(env);
  for (const m of results) {
    await store.delete(m.storage_key);
    await env.DB.prepare('UPDATE media SET storage_key = NULL WHERE id = ?').bind(m.id).run();
  }
  return { deleted: results.length };
}
