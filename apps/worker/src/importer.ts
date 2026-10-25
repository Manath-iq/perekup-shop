import { ACTIVE_TAG } from '@vitrina/core/parser';
import { embedHasPost, parseFeed } from '@vitrina/core/scrape';
import type { Env } from './env';
import { now } from './env';
import { STORE } from './config';
import { addMedia, downloadPending, setStatus, upsertPost } from './ingest';
import type { ListingRow } from './db';
import { kvMediaStore } from './media';

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; RaXiCatalog/1.0)', 'accept-language': 'ru-RU,ru' };

/**
 * Импорт с публичной ленты t.me/s/<channel>: листаем назад через ?before=, берём посты с хэштегом.
 * Посты, которые уже есть в базе, перепарсиваются — так ловим «❌ Продано ❌» на старых карточках.
 */
export async function importChannel(env: Env, channel = STORE.channel, pages = 3) {
  let before: number | null = null;
  let seen = 0;
  let imported = 0;
  let sold = 0;
  for (let i = 0; i < pages; i++) {
    const url = `https://t.me/s/${channel}${before ? `?before=${before}` : ''}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) break;
    const posts = parseFeed(await res.text(), channel);
    if (!posts.length) break;
    for (const p of posts) {
      seen++;
      if (!p.text) continue;
      const r = await upsertPost(env, {
        channel, msg_id: p.msg_id, text: p.text, media_group_id: `feed:${p.msg_id}`,
        date: p.date, post_url: `https://t.me/${channel}/${p.msg_id}`,
      });
      if (!r) continue;
      if (r.created) imported++;
      if (r.becameSold) sold++;
      for (const m of p.media) {
        // у импорта альбом — это один пост, группой служит id первого сообщения
        await addMedia(env, { channel, msg_id: m.msg_id, media_group_id: `feed:${p.msg_id}`, kind: m.kind, source: m.url });
      }
    }
    before = Math.min(...posts.map((p) => p.msg_id));
  }
  const media = await downloadPending(env, 35);
  return { seen, imported, sold, media };
}

/** Удалённые посты: Bot API их не присылает, поэтому раз в час проверяем публичную страницу поста */
export async function checkDeleted(env: Env, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM listings WHERE status = 'active' AND source_channel = ? ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(STORE.channel, limit)
    .all<ListingRow>();
  let removed = 0;
  for (const l of results) {
    const res = await fetch(`https://t.me/${l.source_channel}/${l.channel_msg_id}?embed=1&mode=tme`, { headers: UA });
    if (!res.ok) continue;
    const html = await res.text();
    if (!embedHasPost(html)) {
      await setStatus(env, l.id, 'sold');
      removed++;
    } else if (!html.includes(ACTIVE_TAG.slice(1))) {
      // хэштег убрали, а правка не дошла (например, бот ещё не был в канале)
      await setStatus(env, l.id, 'sold');
      removed++;
    } else {
      await env.DB.prepare('UPDATE listings SET updated_at = ? WHERE id = ?').bind(now(), l.id).run();
    }
  }
  return { checked: results.length, removed };
}

export interface ReviewsMeta {
  url: string;
  title: string;
  subscribers: string | null;
  photos: string[];
  updated_at: number;
}

/** Последние скриншоты из канала отзывов — тем же импортом, в своё хранилище */
export async function importReviews(env: Env, channel = STORE.reviewsChannel): Promise<ReviewsMeta> {
  const [feedRes, pageRes] = await Promise.all([
    fetch(`https://t.me/s/${channel}`, { headers: UA }),
    fetch(`https://t.me/${channel}`, { headers: UA }),
  ]);
  const posts = parseFeed(await feedRes.text(), channel);
  const page = await pageRes.text();
  // t.me отдаёт счётчик по-английски: «10 subscribers»
  const subsNum = page.match(/<div class="tgme_page_extra">([\d\s]+)/)?.[1]?.replace(/\s/g, '');
  const subs = subsNum ? `${subsNum} ${pluralRu(+subsNum, 'подписчик', 'подписчика', 'подписчиков')}` : null;
  const title = page.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Отзывы';
  const photos = posts
    .flatMap((p) => p.media.filter((m) => m.kind === 'photo'))
    .sort((a, b) => b.msg_id - a.msg_id)
    .slice(0, 6);
  const store = kvMediaStore(env);
  const keys: string[] = [];
  for (const ph of photos) {
    const key = `rev/${channel}/${ph.msg_id}`;
    if (!(await store.has(key))) {
      const r = await fetch(ph.url);
      if (!r.ok) continue;
      await store.put(key, await r.arrayBuffer(), r.headers.get('content-type') || 'image/jpeg');
    }
    keys.push(`/media/${key}`);
  }
  const meta: ReviewsMeta = { url: `https://t.me/${channel}`, title, subscribers: subs, photos: keys, updated_at: now() };
  await env.MEDIA.put('meta:reviews', JSON.stringify(meta));
  return meta;
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
