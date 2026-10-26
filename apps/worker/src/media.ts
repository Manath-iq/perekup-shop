import { parseEmbed } from '@vitrina/core/scrape';
import type { Env } from './env';

/**
 * Медиа на бесплатном тарифе: в KV лежат только обложки карточек (одна запись на карточку) и скриншоты отзывов.
 * Галерея и видео не хранятся — /media/i/<id> проксирует их из Telegram, а Workers Caching
 * перед точкой входа CachedMedia кэширует ответы и сам нарезает Range-запросы для видео на iOS.
 */

/** Хранилище медиа. Сейчас KV; для R2 достаточно другой реализации этих методов. */
export interface MediaStore {
  has(key: string): Promise<boolean>;
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export const kvMediaStore = (env: Env): MediaStore => ({
  async has(key) {
    const { keys } = await env.MEDIA.list({ prefix: key, limit: 1 });
    return keys.some((k) => k.name === key);
  },
  async put(key, body, contentType) {
    await env.MEDIA.put(key, body, { metadata: { ct: contentType } });
  },
  async get(key) {
    const r = await env.MEDIA.getWithMetadata<{ ct: string }>(key, 'arrayBuffer');
    if (!r.value) return null;
    return { body: r.value, contentType: r.metadata?.ct ?? 'application/octet-stream' };
  },
  async delete(key) {
    await env.MEDIA.delete(key);
  },
});

/** Bot API отдаёт файлы до 20 МБ */
export const TG_FILE_LIMIT = 20 * 1024 * 1024;
/** Размытое превью больше этого в списке карточек не отдаём — оно идёт в JSON каталога */
export const BLUR_LIMIT = 4 * 1024;

export interface PhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Из размеров фото, которые присылает Telegram (90, 320, 800, 1280, 2560 px), выбираем:
 * галерея — самый большой не больше 1600 px, обложка — первый от 640 px, превью — самый маленький.
 */
export function pickPhotoSizes(sizes: PhotoSize[]): { gallery: PhotoSize; cover: PhotoSize; blur: PhotoSize | null } {
  const sorted = [...sizes].sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height));
  const side = (s: PhotoSize) => Math.max(s.width, s.height);
  const gallery = [...sorted].reverse().find((s) => side(s) <= 1600) ?? sorted[sorted.length - 1];
  const cover = sorted.find((s) => side(s) >= 640) ?? gallery;
  const blur = sorted.length > 1 && side(sorted[0]) <= 160 ? sorted[0] : null;
  return { gallery, cover, blur };
}

/** Разобрать заголовок Range для тела известной длины. null — заголовка нет или он непонятный. */
export function parseRange(range: string | null, size: number): { start: number; end: number } | null {
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - +m[2]);
    end = size - 1;
  } else {
    start = +m[1];
    end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

const notFound = () => new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/** Ответ из буфера: целиком (для кэша) или куском, если Range дошёл до нас — значит, кэша перед воркером нет */
function bufferResponse(body: ArrayBuffer, contentType: string, cacheControl: string, range: string | null): Response {
  const headers: Record<string, string> = { 'content-type': contentType, 'cache-control': cacheControl, 'accept-ranges': 'bytes' };
  const r = parseRange(range, body.byteLength);
  if (r) {
    return new Response(body.slice(r.start, r.end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${body.byteLength}`, 'content-length': String(r.end - r.start + 1) },
    });
  }
  return new Response(body, { headers: { ...headers, 'content-length': String(body.byteLength) } });
}

// file_path из getFile живёт не меньше часа; держим в памяти изолята, чтобы не спрашивать на каждый запрос
const filePaths = new Map<string, { path: string; at: number }>();
const FILE_PATH_TTL = 50 * 60_000;

async function telegramFileUrl(env: Env, fileId: string, fresh = false): Promise<string | null> {
  const hit = filePaths.get(fileId);
  if (hit && !fresh && Date.now() - hit.at < FILE_PATH_TTL) return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${hit.path}`;
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = (await r.json().catch(() => null)) as { ok: boolean; result?: { file_path?: string } } | null;
  const path = j?.ok ? j.result?.file_path : undefined;
  if (!path) return null;
  filePaths.set(fileId, { path, at: Date.now() });
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

/**
 * Скачать файл по источнику: `tg:<file_id>` через Bot API (токен не покидает воркер) или https-ссылку CDN из t.me/s.
 * Range передаётся дальше, чтобы видео не качалось целиком ради первых байт.
 */
export async function fetchSource(env: Env, source: string, range?: string | null): Promise<Response | null> {
  const headers: Record<string, string> = range ? { range } : {};
  if (source.startsWith('tg:')) {
    const id = source.slice(3);
    for (const fresh of [false, true]) {
      const url = await telegramFileUrl(env, id, fresh);
      if (!url) return null;
      const res = await fetch(url, { headers });
      if (res.ok) return res;
      // протух file_path — спросим заново один раз
    }
    return null;
  }
  const res = await fetch(source, { headers: { ...headers, 'user-agent': 'Mozilla/5.0 (compatible; VitrinaCatalog/1.0)' } });
  return res.ok ? res : null;
}

interface MediaRow {
  id: number;
  store_id: string;
  msg_id: number;
  kind: 'photo' | 'video';
  source: string;
  poster_source: string | null;
  file_size: number | null;
  channel: string;
  status: string | null;
}

/**
 * Ссылки CDN из t.me/s протухают. Перечитываем страницу поста и находим свежую ссылку на тот же файл:
 * у каждого фото альбома на embed-странице своя ссылка `…/<id>?single`.
 */
export async function refreshFeedSource(env: Env, row: Pick<MediaRow, 'id' | 'msg_id' | 'kind' | 'channel'>) {
  const res = await fetch(`https://t.me/${row.channel}/${row.msg_id}?embed=1&mode=tme`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; VitrinaCatalog/1.0)' },
  });
  if (!res.ok) return null;
  const found = parseEmbed(await res.text(), row.msg_id).media.find((m) => m.msg_id === row.msg_id && m.kind === row.kind);
  if (!found) return null;
  await env.DB.prepare('UPDATE media SET source = ?, poster_source = COALESCE(?, poster_source) WHERE id = ?')
    .bind(found.url, found.thumb ?? null, row.id)
    .run();
  return { source: found.url, poster: found.thumb ?? null };
}

const PROXY_CACHE = 'public, max-age=604800';
const KV_CACHE = 'public, max-age=31536000, immutable';

async function serveProxied(env: Env, id: number, poster: boolean, req: Request): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT m.id, m.store_id, m.msg_id, m.kind, m.source, m.poster_source, m.file_size, s.channel, l.status
     FROM media m JOIN stores s ON s.id = m.store_id LEFT JOIN listings l ON l.id = m.listing_id WHERE m.id = ?`,
  )
    .bind(id)
    .first<MediaRow>();
  if (!row || row.status === 'hidden') return notFound();
  let source = poster ? row.poster_source : row.source;
  if (!source) return notFound();
  if (!poster && source.startsWith('tg:') && row.file_size && row.file_size > TG_FILE_LIMIT) return notFound();

  const range = req.headers.get('range');
  let upstream = await fetchSource(env, source, range);
  if (!upstream && !source.startsWith('tg:')) {
    const fresh = await refreshFeedSource(env, row);
    source = (poster ? fresh?.poster : fresh?.source) ?? null;
    if (source) upstream = await fetchSource(env, source, range);
  }
  if (!upstream) return notFound();

  const contentType = upstream.headers.get('content-type')?.startsWith(poster || row.kind === 'photo' ? 'image/' : 'video/')
    ? upstream.headers.get('content-type')!
    : poster || row.kind === 'photo'
      ? 'image/jpeg'
      : 'video/mp4';
  // Range дошёл до воркера, а источник отдал файл целиком — режем сами (файлы Bot API не больше 20 МБ)
  if (range && upstream.status === 200) return bufferResponse(await upstream.arrayBuffer(), contentType, PROXY_CACHE, range);
  const headers = new Headers({ 'content-type': contentType, 'cache-control': PROXY_CACHE, 'accept-ranges': 'bytes' });
  for (const h of ['content-length', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function serveKv(env: Env, key: string, req: Request): Promise<Response> {
  const obj = await kvMediaStore(env).get(key);
  if (!obj) return notFound();
  return bufferResponse(obj.body, obj.contentType, KV_CACHE, req.headers.get('range'));
}

/** Точка входа для всех /media/*: `/media/i/<id>[?v=poster]` — прокси, остальное — ключ KV */
export async function handleMedia(env: Env, req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname.slice('/media/'.length));
  const proxied = path.match(/^i\/(\d+)$/);
  if (proxied) return serveProxied(env, +proxied[1], url.searchParams.get('v') === 'poster', req);
  if (!/^(a|c|rev|m)\/[\w./-]+$/.test(path)) return notFound();
  return serveKv(env, path, req);
}
