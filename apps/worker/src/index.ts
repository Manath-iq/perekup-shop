import { Hono, type Context } from 'hono';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { webhookCallback } from 'grammy';
import { listingTitle, formatPrice } from '@vitrina/core/format';
import type { StoreConfig } from '@vitrina/core/store';
import type { ParseProfile } from '@vitrina/core/profile';
import { matchModel } from '@vitrina/core/catalog';
import type { Env } from './env';
import { adminIds, now } from './env';
import { verifyInitData, type TgUser } from './auth';
import { getFacets, getListing, getListingRow, listFavorites, listSubscriptions, logEvent, queryListings, upsertUser, type ListingRow } from './db';
import { cabinetData } from './cabinet';
import { handleMedia } from './media';
import { createBot } from './bot';
import { notifySubscribers, sendBuyRequest, sendQuestion, sendWeeklyStats } from './notify';
import { checkDeleted, importChannel, importReviews, type ReviewsMeta } from './importer';
import { downloadCovers, purgeSoldMedia, reparse, setStatus } from './ingest';
import { listStores, resolveStore, saveStore, type Ctx, type Store } from './store';

type HonoEnv = { Bindings: Env; Variables: { user: TgUser | null; store: Store } };
const app = new Hono<HonoEnv>();
const ctxOf = (c: { env: Env; get(k: 'store'): Store }): Ctx => ({ env: c.env, store: c.get('store') });

// ——— Бот ———
app.post('/bot', (c) => {
  const bot = createBot({ env: c.env, origin: new URL(c.req.url).origin, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  return webhookCallback(bot, 'std/http', { secretToken: c.env.WEBHOOK_SECRET, onTimeout: 'return' })(c.req.raw);
});

// ——— Медиа: через кэшируемую точку входа CachedMedia (Workers Caching) ———
app.get('/media/*', (c) => (c.executionCtx as unknown as { exports: { CachedMedia: Fetcher } }).exports.CachedMedia.fetch(c.req.raw));

/**
 * Перед этой точкой входа стоит Workers Caching (`exports.CachedMedia.cache` в wrangler.jsonc): повторные запросы
 * отдаются из кэша без запуска воркера, Range для видео Cloudflare нарезает сам из закэшированного файла.
 */
export class CachedMedia extends WorkerEntrypoint<Env> {
  fetch(req: Request) {
    return handleMedia(this.env, req);
  }
}

// ——— API: подпись initData проверяется на каждом запросе ———
app.use('/api/*', async (c, next) => {
  const store = await resolveStore(c.env, c.req.header('x-store') ?? c.req.query('s'));
  if (!store) return c.json({ error: 'store not found' }, 404);
  c.set('store', store);
  const user = await verifyInitData(c.req.header('x-init-data') ?? '', c.env.BOT_TOKEN);
  // личные разделы — только с подписью Telegram, даже на демо с открытым чтением
  const personal = /^\/api\/(subscriptions|favorites|me|cabinet)/.test(c.req.path);
  const readOnly = c.req.method === 'GET' && !personal;
  if (!user && !(readOnly && c.env.PUBLIC_READ === '1')) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

const num = (v: string | undefined) => (v ? parseInt(v, 10) || undefined : undefined);

app.get('/api/listings', async (c) => {
  const q = c.req.query();
  const items = await queryListings(ctxOf(c), {
    category: q.category || undefined,
    model_id: q.model || undefined,
    family: q.family || undefined,
    storage: num(q.storage),
    price_min: num(q.price_min),
    price_max: num(q.price_max),
    battery_min: num(q.battery_min),
    condition: q.condition || undefined,
    sim: q.sim === 'physical' || q.sim === 'esim' ? q.sim : undefined,
    sort: (q.sort as 'new') || 'new',
  });
  return c.json({ items });
});

app.get('/api/listings/:id', async (c) => {
  const l = await getListing(ctxOf(c), +c.req.param('id'));
  if (!l || l.status === 'hidden') return c.json({ error: 'not found' }, 404);
  return c.json(l);
});

app.get('/api/facets', async (c) => c.json(await getFacets(ctxOf(c))));

app.get('/api/store', async (c) => {
  const { store } = ctxOf(c);
  const reviews = await c.env.MEDIA.get<ReviewsMeta>(`meta:reviews:${store.id}`, 'json');
  const cfg = store.config;
  return c.json({
    id: store.id,
    name: cfg.name,
    channel: cfg.channel,
    seller: cfg.seller,
    avatar: cfg.avatar ?? null,
    theme: cfg.theme ?? null,
    bot_username: c.env.BOT_USERNAME,
    default_brand: store.profile.defaultBrand ?? null,
    about: { city: '', delivery: '', warranty: '', payment: '', ...cfg.about, demo: store.kind === 'demo' },
    reviews,
  });
});

app.get('/api/me', (c) => {
  const user = c.get('user')!;
  return c.json({ id: user.id, is_admin: adminIds(c.env).includes(user.id) });
});

const EVENT_TYPES = new Set(['app_open', 'card_view', 'search']);
app.post('/api/events', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{ type: string; listing_id?: number; model_id?: string; meta?: unknown }>().catch(() => null);
  if (!body || !EVENT_TYPES.has(body.type)) return c.json({ error: 'bad event' }, 400);
  const ctx = ctxOf(c);
  if (body.type === 'app_open') c.executionCtx.waitUntil(upsertUser(ctx, user));
  await logEvent(ctx, body.type, user.id, { listing_id: body.listing_id, model_id: body.model_id, meta: body.meta });
  return c.json({ ok: true });
});

app.post('/api/buy', async (c) => {
  const user = c.get('user')!;
  const ctx = ctxOf(c);
  const { listing_id, kind = 'buy' } = await c.req.json<{ listing_id: number; kind?: 'buy' | 'ask' }>();
  const l = await getListingRow(ctx, listing_id);
  if (!l) return c.json({ error: 'not found' }, 404);
  const seller = `https://t.me/${ctx.store.config.seller}`;
  // «Спросить» — без заявки: продавцу приходит, что покупатель пишет про этот товар
  if (kind === 'ask') {
    await logEvent(ctx, 'ask_click', user.id, { listing_id: l.id, model_id: l.model_id });
    c.executionCtx.waitUntil(sendQuestion(ctx, l, user));
    const text = `Здравствуйте! Вопрос по ${listingTitle(l)} (пост ${l.msg_id}): `;
    return c.json({ ok: true, text, url: `${seller}?text=${encodeURIComponent(text)}` });
  }
  await logEvent(ctx, 'buy_click', user.id, { listing_id: l.id, model_id: l.model_id });
  await c.env.DB.prepare('INSERT INTO leads (store_id, listing_id, tg_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(ctx.store.id, l.id, user.id, now(), now())
    .run();
  c.executionCtx.waitUntil(sendBuyRequest(ctx, l, user));
  const text = `Здравствуйте! Хочу ${listingTitle(l)}${l.price ? ` за ${formatPrice(l.price)}` : ''} (пост ${l.msg_id})`;
  return c.json({ ok: true, text, url: `${seller}?text=${encodeURIComponent(text)}` });
});

app.get('/api/subscriptions', async (c) => c.json({ items: await listSubscriptions(ctxOf(c), c.get('user')!.id) }));

app.post('/api/subscriptions', async (c) => {
  const user = c.get('user')!;
  const ctx = ctxOf(c);
  const b = await c.req.json<{ model_id?: string; title?: string; storage_gb?: number | null; max_price?: number | null }>();
  // модель приходит из умного поиска мини-аппа: сверяем id со словарём, чтобы в базу не попал мусор
  const matched = b.title ? matchModel(b.title) : null;
  const model = matched && matched.id === b.model_id ? { model_id: matched.id, title: matched.title } : null;
  if (!model) return c.json({ error: 'model required' }, 400);
  await c.env.DB.prepare(
    'INSERT INTO subscriptions (store_id, tg_user_id, model_id, title, storage_gb, max_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(ctx.store.id, user.id, model.model_id, model.title, b.storage_gb || null, b.max_price || null, now())
    .run();
  await logEvent(ctx, 'subscribe', user.id, { model_id: model.model_id, meta: { storage_gb: b.storage_gb, max_price: b.max_price } });
  c.executionCtx.waitUntil(upsertUser(ctx, user));
  return c.json({ items: await listSubscriptions(ctx, user.id) });
});

app.delete('/api/subscriptions/:id', async (c) => {
  const user = c.get('user')!;
  const ctx = ctxOf(c);
  await c.env.DB.prepare('UPDATE subscriptions SET active = 0 WHERE id = ? AND tg_user_id = ? AND store_id = ?')
    .bind(+c.req.param('id'), user.id, ctx.store.id)
    .run();
  return c.json({ items: await listSubscriptions(ctx, user.id) });
});

// ——— Избранное ———
app.get('/api/favorites', async (c) => c.json({ items: await listFavorites(ctxOf(c), c.get('user')!.id) }));

app.put('/api/favorites/:id', async (c) => {
  const ctx = ctxOf(c);
  const l = await getListingRow(ctx, +c.req.param('id'));
  if (!l) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO favorites (store_id, tg_user_id, listing_id, price, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(ctx.store.id, c.get('user')!.id, l.id, l.price, now())
    .run();
  return c.json({ ok: true });
});

app.delete('/api/favorites/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM favorites WHERE store_id = ? AND tg_user_id = ? AND listing_id = ?')
    .bind(ctxOf(c).store.id, c.get('user')!.id, +c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// ——— Кабинет продавца: только для ADMIN_IDS ———
app.use('/api/cabinet/*', async (c, next) => {
  if (!adminIds(c.env).includes(c.get('user')?.id ?? 0)) return c.json({ error: 'forbidden' }, 403);
  await next();
});
app.use('/api/cabinet', async (c, next) => {
  if (!adminIds(c.env).includes(c.get('user')?.id ?? 0)) return c.json({ error: 'forbidden' }, 403);
  await next();
});

app.get('/api/cabinet', async (c) => c.json(await cabinetData(ctxOf(c), Math.min(90, num(c.req.query('days')) ?? 7))));

const LISTING_ACTIONS = { hide: 'hidden', sold: 'sold', reserve: 'reserved', active: 'active' } as const;

app.post('/api/cabinet/listings/:id', async (c) => {
  const ctx = ctxOf(c);
  const id = +c.req.param('id');
  const { action } = await c.req.json<{ action: 'confirm' | keyof typeof LISTING_ACTIONS }>();
  if (action === 'confirm') {
    const l = await c.env.DB.prepare('UPDATE listings SET confirmed = 1 WHERE id = ? AND store_id = ? RETURNING *').bind(id, ctx.store.id).first<ListingRow>();
    if (!l) return c.json({ error: 'not found' }, 404);
    c.executionCtx.waitUntil(notifySubscribers(ctx, new URL(c.req.url).origin, l));
    return c.json({ ok: true });
  }
  if (!(action in LISTING_ACTIONS)) return c.json({ error: 'bad action' }, 400);
  const l = await setStatus(ctx, id, LISTING_ACTIONS[action]);
  return l ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
});

app.post('/api/cabinet/leads/:id', async (c) => {
  const ctx = ctxOf(c);
  const { status } = await c.req.json<{ status: 'new' | 'work' | 'sold' }>();
  if (!['new', 'work', 'sold'].includes(status)) return c.json({ error: 'bad status' }, 400);
  const lead = await c.env.DB.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND store_id = ? RETURNING listing_id')
    .bind(status, now(), +c.req.param('id'), ctx.store.id)
    .first<{ listing_id: number }>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  // «Продал» снимает карточку; правка поста в канале — на этапе 5
  if (status === 'sold') await setStatus(ctx, lead.listing_id, 'sold');
  return c.json({ ok: true });
});

// ——— Админка для CLI (ключ в секрете ADMIN_API_KEY) ———
app.use('/admin/*', async (c, next) => {
  if (!c.env.ADMIN_API_KEY || c.req.header('x-admin-key') !== c.env.ADMIN_API_KEY) return c.json({ error: 'forbidden' }, 403);
  await next();
});

app.put('/admin/store', async (c) => {
  const b = await c.req.json<{ config: StoreConfig; profile: Partial<ParseProfile>; kind?: 'client' | 'demo'; expires_at?: number | null }>();
  if (!b?.config?.slug || !b.config.channel) return c.json({ error: 'config.slug и config.channel обязательны' }, 400);
  if (c.env.STORE_ID && b.config.slug !== c.env.STORE_ID) return c.json({ error: `этот деплой обслуживает магазин ${c.env.STORE_ID}` }, 400);
  await saveStore(c.env, b);
  return c.json({ ok: true });
});

// остальные команды работают с магазином из ?store= (у клиентского деплоя — с единственным)
type AdminCtx = Context<HonoEnv>;
const withStore = (fn: (ctx: Ctx, c: AdminCtx) => Promise<unknown>) => async (c: AdminCtx) => {
  const store = await resolveStore(c.env, c.req.query('store'));
  if (!store) return c.json({ error: 'store not found' }, 404);
  return c.json(await fn({ env: c.env, store }, c));
};
app.post('/admin/import', withStore((ctx, c) => importChannel(ctx, num(c.req.query('pages')) ?? 3)));
app.post('/admin/media', withStore((ctx) => downloadCovers(ctx, 12)));
app.post('/admin/reviews', withStore((ctx) => importReviews(ctx)));
app.post('/admin/check', withStore((ctx) => checkDeleted(ctx)));
app.post('/admin/purge', withStore((ctx, c) => purgeSoldMedia(ctx, num(c.req.query('days')) ?? 7)));
app.post('/admin/reparse', withStore((ctx, c) => reparse(ctx, num(c.req.query('offset')) ?? 0, num(c.req.query('limit')) ?? 25)));

/**
 * Часовая работа: удалённые посты, обложки, чистка KV, старые события.
 * Бесплатный Workers разрешает 50 внешних подзапросов на вызов: клиенту — 15 проверок и 6 обложек,
 * демо-деплою — по 3 и 2 на магазин, магазины в случайном порядке, пока хватает бюджета.
 */
async function hourly(env: Env) {
  const stores = (await listStores(env)).sort(() => Math.random() - 0.5);
  let budget = 40;
  for (const store of stores) {
    const ctx: Ctx = { env, store };
    const [checks, covers] = env.STORE_ID ? [15, 6] : [3, 2];
    if (budget < checks + covers * 2) break;
    budget -= checks + covers * 2;
    await checkDeleted(ctx, checks);
    await downloadCovers(ctx, covers);
    await purgeSoldMedia(ctx);
  }
  await env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(now() - 90 * 86400).run();
  await env.DB.prepare('DELETE FROM media WHERE listing_id IS NULL AND created_at < ?').bind(now() - 86400).run();
}

/** Еженедельная статистика — понедельник, 10:00 МСК */
const isWeeklySlot = (d: Date) => d.getUTCDay() === 1 && d.getUTCHours() === 7;

async function runCron(env: Env, at: Date) {
  await hourly(env);
  if (isWeeklySlot(at)) for (const store of await listStores(env)) if (store.kind === 'client') await sendWeeklyStats({ env, store });
}

// Планировщик (один cron на все деплои) дёргает этот адрес раз в час
app.post('/cron', async (c) => {
  if (!c.env.ADMIN_API_KEY || c.req.header('x-admin-key') !== c.env.ADMIN_API_KEY) return c.json({ error: 'forbidden' }, 403);
  c.executionCtx.waitUntil(runCron(c.env, new Date()));
  return c.json({ ok: true });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
