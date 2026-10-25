import type { Env } from './env';

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

/** Отдать медиа с долгим кэшем и поддержкой Range (без него iOS не играет видео) */
export async function serveMedia(env: Env, key: string, req: Request): Promise<Response> {
  const cache = caches.default;
  const range = req.headers.get('range');
  if (!range) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  const obj = await kvMediaStore(env).get(key);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = {
    'content-type': obj.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };
  const size = obj.body.byteLength;
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2];
    const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    return new Response(obj.body.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  const res = new Response(obj.body, { headers: { ...headers, 'content-length': String(size) } });
  await cache.put(req, res.clone());
  return res;
}
