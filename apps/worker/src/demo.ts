import { now } from './env';
import type { Env } from './env';
import { addMedia, upsertPost } from './ingest';
import { kvMediaStore } from './media';
import type { Ctx } from './store';

/** Пост ленты t.me/s, разобранный в CLI: текст и ссылки CDN на медиа */
export interface FeedPost {
  msg_id: number;
  text: string;
  date: number;
  media: { msg_id: number; kind: 'photo' | 'video'; url: string; thumb?: string }[];
}

/**
 * Пакет постов от CLI: тяжёлый разбор ленты идёт локально, воркер только сохраняет.
 * Gemini-фолбэк включён — неуверенные посты дополняются, у демо подтверждать некому.
 */
export async function ingestFeed(ctx: Ctx, posts: FeedPost[], llm = true) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const p of posts) {
    if (!p.text) {
      skipped++;
      continue;
    }
    // у ленты альбом — это один пост, группой служит id первого сообщения
    const group = `feed:${p.msg_id}`;
    const results = await upsertPost(ctx, { msg_id: p.msg_id, text: p.text, media_group_id: group, date: p.date, post_url: `https://t.me/${ctx.store.channel}/${p.msg_id}` }, { llm });
    if (!results.length) {
      skipped++;
      continue;
    }
    created += results.filter((r) => r.created).length;
    updated += results.filter((r) => !r.created).length;
    for (const m of p.media) await addMedia(ctx, { msg_id: m.msg_id, media_group_id: group, kind: m.kind, source: m.url, poster_source: m.thumb ?? null });
  }
  return { created, updated, skipped };
}

/** Аватар канала — в KV, ссылки t.me на картинки протухают */
export async function saveAvatar(ctx: Ctx, body: ArrayBuffer, contentType: string) {
  const key = `a/${ctx.store.id.replace(/[^\w-]/g, '')}`;
  await kvMediaStore(ctx.env).put(key, body, contentType);
  return `/media/${key}`;
}

/**
 * Удалить магазин целиком: демо через неделю или пересоздание демо с нуля.
 * KV-ключей у магазина немного — обложки, аватар и отзывы, в бесплатный лимит записей укладывается.
 */
export async function purgeStore(env: Env, storeId: string) {
  const kv = kvMediaStore(env);
  const { results } = await env.DB.prepare(`SELECT storage_key FROM media WHERE store_id = ? AND storage_key IS NOT NULL AND storage_key != 'skip'`)
    .bind(storeId)
    .all<{ storage_key: string }>();
  for (const r of results) await kv.delete(r.storage_key);
  await kv.delete(`a/${storeId}`);
  await env.MEDIA.delete(`meta:reviews:${storeId}`);
  const ids = `SELECT id FROM listings WHERE store_id = ?`;
  await env.DB.batch(
    [
      `DELETE FROM price_history WHERE listing_id IN (${ids})`,
      `DELETE FROM notifications WHERE listing_id IN (${ids})`,
      'DELETE FROM favorites WHERE store_id = ?',
      'DELETE FROM leads WHERE store_id = ?',
      'DELETE FROM subscriptions WHERE store_id = ?',
      'DELETE FROM events WHERE store_id = ?',
      'DELETE FROM media WHERE store_id = ?',
      'DELETE FROM listings WHERE store_id = ?',
      'DELETE FROM posts WHERE store_id = ?',
      'DELETE FROM stores WHERE id = ?',
    ].map((sql) => env.DB.prepare(sql).bind(storeId)),
  );
  return { deleted_media: results.length };
}

/** Демо, у которых истёк срок: по одному за запуск, чтобы не съесть лимит удалений KV */
export async function purgeExpired(env: Env) {
  const row = await env.DB.prepare(`SELECT id FROM stores WHERE kind = 'demo' AND expires_at IS NOT NULL AND expires_at < ? LIMIT 1`)
    .bind(now())
    .first<{ id: string }>();
  if (row) await purgeStore(env, row.id);
  return row?.id ?? null;
}
