/**
 * CLI Витрины. Тяжёлое (разбор сотен постов, генерация профиля) идёт здесь, локально, без лимитов бесплатного Workers.
 *
 *   npm run cli -- profile:test <slug|канал> [страниц]   разобрать ленту t.me/s и показать отчёт по уверенности
 *   npm run cli -- store:push <slug>                     залить clients/<slug>/client.jsonc и profile.json в воркер
 *   npm run cli -- import <slug> [страниц]               импорт ленты канала в воркер
 *   npm run cli -- reparse <slug>                        перепарсить сохранённые посты после правки профиля
 *
 *   npm run cli -- demo <канал> [--pages 10] [--days 7] [--seller username] [--stale дней] [--fresh]
 *                                                        демо на любом публичном канале: ссылка и QR за минуту
 *   npm run cli -- demos                                 список демо-магазинов
 *   npm run cli -- demo:delete <канал>                   удалить демо
 *
 * Адрес воркера и ключ: VITRINA_URL и ADMIN_API_KEY (по умолчанию — локальный wrangler dev с ключом dev),
 * для демо — DEMO_URL и DEMO_ADMIN_KEY. Всё читается из .env в корне.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parsePost, type ParseResult } from '../packages/core/src/parse';
import { parseFeed, type ScrapedPost } from '../packages/core/src/scrape';
import type { ParseProfile } from '../packages/core/src/profile';
import type { StoreConfig } from '../packages/core/src/store';
import { runDemo } from './demo';

// .env в корне: секреты для CLI, в репозиторий не попадает
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.VITRINA_URL ?? 'http://localhost:8787';
const KEY = process.env.ADMIN_API_KEY ?? 'dev';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; VitrinaCLI/1.0)', 'accept-language': 'ru-RU,ru' };

const stripJsonComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');

function loadClient(slug: string): { config: StoreConfig; profile: Partial<ParseProfile> } {
  const dir = new URL(`../clients/${slug}/`, import.meta.url);
  if (!existsSync(new URL('client.jsonc', dir))) throw new Error(`нет clients/${slug}/client.jsonc`);
  const config = JSON.parse(stripJsonComments(readFileSync(new URL('client.jsonc', dir), 'utf8'))) as StoreConfig;
  const profilePath = new URL('profile.json', dir);
  const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : {};
  return { config, profile };
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-admin-key': KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Последние посты публичного канала: листаем t.me/s назад через ?before= */
export async function fetchFeed(channel: string, pages: number): Promise<ScrapedPost[]> {
  const out: ScrapedPost[] = [];
  let before: number | null = null;
  for (let i = 0; i < pages; i++) {
    const res = await fetch(`https://t.me/s/${channel}${before ? `?before=${before}` : ''}`, { headers: UA });
    if (!res.ok) throw new Error(`t.me/s/${channel}: HTTP ${res.status}`);
    const posts = parseFeed(await res.text(), channel);
    if (!posts.length) break;
    out.push(...posts);
    before = Math.min(...posts.map((p) => p.msg_id));
  }
  return out.sort((a, b) => b.msg_id - a.msg_id);
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—');

async function profileTest(target: string, pages: number) {
  const known = existsSync(new URL(`../clients/${target}/client.jsonc`, import.meta.url));
  const { config, profile } = known ? loadClient(target) : { config: { channel: target } as StoreConfig, profile: {} };
  const posts = (await fetchFeed(config.channel, pages)).filter((p) => p.text);
  const results = posts.map((p) => ({ post: p, r: parsePost(p.text, profile) }));
  const by = (s: ParseResult['status']) => results.filter((x) => x.r.status === s);
  const listings = results.filter((x) => x.r.status !== 'not_listing');
  const ok = listings.filter((x) => x.r.parse_ok);
  console.log(`\n@${config.channel}: ${posts.length} постов с текстом${known ? '' : ' (профиль по умолчанию)'}`);
  console.log(`  в наличии ${by('active').length}, бронь ${by('reserved').length}, продано ${by('sold').length}, не объявления ${by('not_listing').length}`);
  console.log(`  уверенно разобрано ${ok.length} из ${listings.length} объявлений (${pct(ok.length, listings.length)})`);
  const weak = listings.filter((x) => !x.r.parse_ok);
  if (weak.length) {
    console.log('\nНиже порога:');
    for (const { post, r } of weak.slice(0, 15)) {
      const first = post.text.split('\n').find((l) => l.trim())?.slice(0, 70);
      console.log(`  ${post.msg_id}  нет: ${r.missing.join(', ') || `уверенность ${r.confidence}`}  «${first}»`);
    }
  }
  const models = new Map<string, number>();
  for (const { r } of by('active')) if (r.model) models.set(r.model.title, (models.get(r.model.title) ?? 0) + 1);
  if (models.size) console.log(`\nМодели в наличии: ${[...models].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ×${n}`).join(', ')}`);
}

function flags(args: string[]) {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([\w-]+)$/);
    if (!m) continue;
    const next = args[i + 1];
    if (next && !next.startsWith('--')) (out[m[1]] = next), i++;
    else out[m[1]] = true;
  }
  return out;
}

const demoTarget = () => {
  const base = process.env.DEMO_URL;
  const key = process.env.DEMO_ADMIN_KEY;
  if (!base || !key) throw new Error('нужны DEMO_URL и DEMO_ADMIN_KEY в .env');
  return { base: base.replace(/\/$/, ''), key };
};

async function main() {
  const [cmd, arg, extra] = process.argv.slice(2);
  switch (cmd) {
    case 'demo': {
      if (!arg) throw new Error('укажите канал: npm run cli -- demo apple_raxi');
      const f = flags(process.argv.slice(4));
      return runDemo({
        channel: arg,
        pages: Number(f.pages) || 10,
        days: Number(f.days) || 7,
        fresh: !!f.fresh,
        seller: typeof f.seller === 'string' ? f.seller.replace(/^@/, '') : undefined,
        staleDays: f.stale !== undefined ? Number(f.stale) || 0 : undefined,
        ...demoTarget(),
        bot: process.env.BOT_USERNAME ?? 'perekup_shop_bot',
        geminiKey: process.env.GEMINI_API_KEY,
      });
    }
    case 'demos': {
      const { base, key } = demoTarget();
      const list = (await (await fetch(`${base}/admin/stores`, { headers: { 'x-admin-key': key } })).json()) as { id: string; name: string; expires_at: number | null }[];
      for (const s of list) {
        const days = s.expires_at ? Math.ceil((s.expires_at * 1000 - Date.now()) / 86400000) : '∞';
        console.log(`${s.id.padEnd(24)} ${s.name}  · ещё ${days} дн. · https://t.me/${process.env.BOT_USERNAME ?? 'perekup_shop_bot'}?start=${s.id}`);
      }
      return;
    }
    case 'demo:delete': {
      const { base, key } = demoTarget();
      const res = await fetch(`${base}/admin/store?store=${arg.replace(/^@/, '').toLowerCase()}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
      console.log(res.status, await res.text());
      return;
    }
    case 'profile:test':
      if (!arg) throw new Error('укажите slug клиента или канал');
      return profileTest(arg, Number(extra) || 5);
    case 'store:push': {
      const { config, profile } = loadClient(arg);
      console.log(await admin('PUT', '/admin/store', { config, profile }));
      return;
    }
    case 'import': {
      console.log('импорт:', await admin('POST', `/admin/import?store=${arg}&pages=${Number(extra) || 3}`));
      let media = (await admin('POST', `/admin/media?store=${arg}`)) as { remaining: number };
      while (media.remaining > 0) {
        console.log('медиа:', media);
        media = (await admin('POST', `/admin/media?store=${arg}`)) as { remaining: number };
      }
      console.log('отзывы:', await admin('POST', `/admin/reviews?store=${arg}`));
      return;
    }
    case 'reparse': {
      let offset: number | null = 0;
      while (offset !== null) {
        const r = (await admin('POST', `/admin/reparse?store=${arg}&offset=${offset}`)) as { next: number | null };
        console.log(r);
        offset = r.next;
      }
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)?.[1].replace(/^ \* ?/gm, ''));
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
