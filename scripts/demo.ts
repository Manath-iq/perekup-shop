/**
 * Демо на любом публичном канале: `npm run cli -- demo <канал>`.
 * Лента и профиль разбора готовятся локально, в демо-воркер уходят готовые посты, обложки качает воркер.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { generateProfile } from '../packages/core/src/autoprofile';
import { parseItems } from '../packages/core/src/parse';
import { resolveProfile, type ParseProfile } from '../packages/core/src/profile';
import { parseFeed, type ScrapedPost } from '../packages/core/src/scrape';
import type { StoreConfig } from '../packages/core/src/store';

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; VitrinaCLI/1.0)', 'accept-language': 'ru-RU,ru' };

export interface DemoOptions {
  channel: string;
  pages: number;
  days: number;
  fresh: boolean;
  seller?: string;
  /** Переопределить срок устаревания объявлений: 0 — не устаревают (демо на неактивном канале) */
  staleDays?: number;
  base: string;
  key: string;
  bot: string;
  geminiKey?: string;
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Страница канала: название, описание, аватар */
async function channelInfo(channel: string) {
  const res = await fetch(`https://t.me/${channel}`, { headers: UA });
  if (!res.ok) throw new Error(`t.me/${channel}: HTTP ${res.status}`);
  const html = await res.text();
  const meta = (p: string) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1];
  const title = decode(meta('title') ?? channel);
  // у несуществующего или закрытого канала t.me отдаёт общую страницу без счётчика подписчиков
  if (!/tgme_page_extra/.test(html)) throw new Error(`канал @${channel} не найден или закрыт`);
  return { title, description: decode(meta('description') ?? ''), avatar: meta('image') ?? null };
}

async function fetchFeed(channel: string, pages: number): Promise<ScrapedPost[]> {
  const out: ScrapedPost[] = [];
  let before: number | null = null;
  for (let i = 0; i < pages; i++) {
    const res = await fetch(`https://t.me/s/${channel}${before ? `?before=${before}` : ''}`, { headers: UA });
    if (!res.ok) break;
    const posts = parseFeed(await res.text(), channel);
    if (!posts.length) break;
    out.push(...posts);
    before = Math.min(...posts.map((p) => p.msg_id));
  }
  const seen = new Set<number>();
  return out.filter((p) => !seen.has(p.msg_id) && seen.add(p.msg_id)).sort((a, b) => b.msg_id - a.msg_id);
}

/** Кому писать «Купить»: самый частый @username в постах и описании, кроме самого канала и канала отзывов */
function detectContacts(channel: string, description: string, posts: ScrapedPost[]) {
  const counts = new Map<string, number>();
  const reviews = new Map<string, number>();
  for (const text of [description, ...posts.map((p) => p.text)]) {
    for (const m of text.matchAll(/(?:@|t\.me\/)([A-Za-z][\w]{3,31})/g)) {
      const name = m[1];
      if (name.toLowerCase() === channel.toLowerCase() || /bot$/i.test(name) || name === 's') continue;
      const bag = /otz|otziv|review|feedback|отзыв/i.test(name) ? reviews : counts;
      bag.set(name, (bag.get(name) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { seller: top(counts), reviews: top(reviews) };
}

async function admin(o: DemoOptions, method: string, path: string, body?: BodyInit, contentType = 'application/json') {
  const res = await fetch(`${o.base}${path}`, { method, headers: { 'x-admin-key': o.key, 'content-type': contentType }, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function runDemo(o: DemoOptions) {
  const channel = o.channel.replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, '').replace(/\/.*$/, '');
  const slug = channel.toLowerCase();
  const t0 = Date.now();
  const step = (s: string) => console.log(`· ${s}`);

  step(`читаю @${channel}`);
  const info = await channelInfo(channel);
  const posts = await fetchFeed(channel, o.pages);
  const texts = posts.map((p) => p.text).filter(Boolean);
  if (!texts.length) throw new Error(`в ленте @${channel} нет постов с текстом — канал закрыт или пуст`);
  step(`${posts.length} постов, «${info.title}»`);

  let profile: ParseProfile | undefined;
  let explanation = '';
  if (o.geminiKey) {
    step('Gemini подбирает профиль разбора');
    try {
      const g = await generateProfile(texts, { apiKey: o.geminiKey });
      profile = g.profile;
      explanation = g.explanation;
      step(
        g.chosen === 'generated'
          ? `профиль канала: уверенно ${pct(g.report.share)} (по умолчанию было ${pct(g.baseline.share)})`
          : `профиль модели хуже стандартного (${pct(g.baseline.share)}), беру стандартный`,
      );
    } catch (e) {
      step(`Gemini недоступен (${String(e).slice(0, 120)}), беру профиль по умолчанию`);
    }
  }
  if (o.staleDays !== undefined) profile = { ...resolveProfile(profile), staleDays: o.staleDays };
  const prof = resolveProfile(profile);
  const parsed = posts.filter((p) => p.text).map((p) => ({ post: p, items: parseItems(p.text, prof) }));
  const all = parsed.flatMap((x) => x.items.map((r) => ({ r, text: r.line ?? x.post.text })));
  const listings = all.filter((x) => x.r.status !== 'not_listing');
  const share = listings.length ? listings.filter((x) => x.r.parse_ok).length / listings.length : 0;
  const lists = parsed.filter((x) => x.items.length > 1).length;
  const lastDays = Math.floor((Date.now() / 1000 - posts[0].date) / 86400);
  const contacts = detectContacts(channel, info.description, posts);
  const seller = o.seller ?? contacts.seller ?? channel;

  const config: StoreConfig = {
    slug,
    name: info.title,
    channel,
    seller,
    ...(contacts.reviews ? { reviewsChannel: contacts.reviews } : {}),
    theme: { preset: 'graphite', accent: '#ff5b1f' },
    about: {},
  };

  if (o.fresh) {
    step('удаляю прежнее демо');
    await admin(o, 'DELETE', `/admin/store?store=${slug}`).catch(() => {});
  }
  step('создаю магазин');
  await admin(o, 'PUT', '/admin/store', JSON.stringify({ config, profile: profile ?? {}, kind: 'demo', expires_at: Math.floor(Date.now() / 1000) + o.days * 86400 }));

  if (info.avatar) {
    const a = await fetch(info.avatar, { headers: UA }).catch(() => null);
    if (a?.ok) await admin(o, 'PUT', `/admin/avatar?store=${slug}`, await a.arrayBuffer(), a.headers.get('content-type') ?? 'image/jpeg').catch(() => {});
  }

  // старые посты первыми: так правка «продано» в свежем посте не перетрётся старым
  const ordered = [...posts].reverse().map((p) => ({ msg_id: p.msg_id, text: p.text, date: p.date, media: p.media.map((m) => ({ msg_id: m.msg_id, kind: m.kind, url: m.url, thumb: m.thumb })) }));
  let created = 0;
  for (let i = 0; i < ordered.length; i += 15) {
    const r = (await admin(o, 'POST', `/admin/ingest?store=${slug}`, JSON.stringify({ posts: ordered.slice(i, i + 15) }))) as { created: number };
    created += r.created;
    process.stdout.write(`\r· заливаю посты: ${Math.min(i + 15, ordered.length)} из ${ordered.length}`);
  }
  process.stdout.write('\n');

  let media = (await admin(o, 'POST', `/admin/media?store=${slug}`)) as { done: number; remaining: number };
  let guard = 0;
  while (media.remaining > 0 && guard++ < 30) {
    process.stdout.write(`\r· обложки: осталось ${media.remaining}   `);
    media = (await admin(o, 'POST', `/admin/media?store=${slug}`)) as { done: number; remaining: number };
  }
  process.stdout.write('\r· обложки готовы            \n');
  if (config.reviewsChannel) await admin(o, 'POST', `/admin/reviews?store=${slug}`).catch(() => {});

  const facets = (await fetch(`${o.base}/api/facets?s=${slug}`).then((r) => r.json())) as { total: number; models: { title: string; count: number }[] };
  const botLink = `https://t.me/${o.bot}?start=${slug}`;
  const webLink = `${o.base}/?s=${slug}`;
  const weak = listings.filter(({ r }) => !r.parse_ok).slice(0, 8);
  const staleWarn =
    prof.mode === 'unless_sold' && prof.staleDays > 0 && lastDays > prof.staleDays
      ? `\n⚠️ Последний пост ${lastDays} дн. назад, а объявления старше ${prof.staleDays} дн. считаются неактуальными — витрина пустая. Для показа: --stale 0`
      : '';

  const lines = [
    '',
    `Готово за ${Math.round((Date.now() - t0) / 1000)} с — «${info.title}» (@${channel})`,
    `Найдено ${posts.length} постов${lists ? `, из них ${lists} прайсов` : ''}: ${listings.length} объявлений, в наличии ${facets.total}, проданы или устарели ${Math.max(0, listings.length - facets.total)}`,
    `Разобрано уверенно ${pct(share)} объявлений · последний пост ${lastDays ? `${lastDays} дн. назад` : 'сегодня'}${explanation ? `\nКак оформляет посты: ${explanation}` : ''}${staleWarn}`,
    `Кнопка «Купить» ведёт к @${seller}${o.seller ? '' : contacts.seller ? ' (найден в постах)' : ' — продавец не найден, укажите --seller'}`,
    facets.models.length ? `Модели: ${facets.models.map((m) => `${m.title} ×${m.count}`).join(', ')}` : '',
    weak.length ? `\nРазобраны неуверенно (${weak.length}):\n${weak.map(({ r, text }) => `  нет ${r.missing.join(', ') || 'уверенности'} — «${text.split('\n').find((l) => l.trim())?.slice(0, 60)}»`).join('\n')}` : '',
    '',
    `Ссылка для перекупа:  ${botLink}`,
    `В браузере:          ${webLink}`,
    `Демо живёт ${o.days} дн., потом удаляется само.`,
  ].filter((l) => l !== '');
  console.log(lines.join('\n'));
  console.log(await QRCode.toString(botLink, { type: 'terminal', small: true }));

  const dir = new URL(`../demos/${slug}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('profile.json', dir), JSON.stringify(profile ?? {}, null, 2));
  writeFileSync(new URL('report.txt', dir), lines.join('\n') + '\n');
  await QRCode.toFile(new URL('qr.png', dir).pathname, botLink, { width: 640, margin: 2 });
  console.log(`Профиль, отчёт и QR: demos/${slug}/`);
}
