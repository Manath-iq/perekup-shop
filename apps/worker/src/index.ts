import { Hono } from 'hono';
import { webhookCallback } from 'grammy';
import { listingTitle, formatPrice } from '@vitrina/core/parser';
import type { Env } from './env';
import { now } from './env';
import { verifyInitData, type TgUser } from './auth';
import { getFacets, getListing, getListingRow, listSubscriptions, logEvent, queryListings, upsertUser } from './db';
import { serveMedia } from './media';
import { createBot } from './bot';
import { sendBuyRequest, sendWeeklyStats } from './notify';
import { checkDeleted, importChannel, importReviews, type ReviewsMeta } from './importer';
import { downloadPending, purgeSoldMedia } from './ingest';
import { STORE } from './config';

type Ctx = { Bindings: Env; Variables: { user: TgUser | null } };
const app = new Hono<Ctx>();

// ——— Бот ———
app.post('/bot', (c) => {
  const bot = createBot({ env: c.env, origin: new URL(c.req.url).origin, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  return webhookCallback(bot, 'std/http', { secretToken: c.env.WEBHOOK_SECRET, onTimeout: 'return' })(c.req.raw);
});

// ——— Медиа ———
app.get('/media/*', (c) => serveMedia(c.env, decodeURIComponent(c.req.path.slice('/media/'.length)), c.req.raw));

// ——— API: подпись initData проверяется на каждом запросе ———
app.use('/api/*', async (c, next) => {
  const initData = c.req.header('x-init-data') ?? '';
  const user = await verifyInitData(initData, c.env.BOT_TOKEN);
  const readOnly = c.req.method === 'GET' && !c.req.path.startsWith('/api/subscriptions');
  if (!user && !(readOnly && c.env.PUBLIC_READ === '1')) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

const num = (v: string | undefined) => (v ? parseInt(v, 10) || undefined : undefined);

app.get('/api/listings', async (c) => {
  const q = c.req.query();
  const items = await queryListings(c.env, {
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
  const l = await getListing(c.env, +c.req.param('id'));
  if (!l || l.status === 'hidden') return c.json({ error: 'not found' }, 404);
  return c.json(l);
});

app.get('/api/facets', async (c) => c.json(await getFacets(c.env)));

app.get('/api/store', async (c) => {
  const reviews = await c.env.MEDIA.get<ReviewsMeta>('meta:reviews', 'json');
  return c.json({ name: STORE.name, channel: STORE.channel, seller: STORE.sellerUsername, about: STORE.about, reviews });
});

const EVENT_TYPES = new Set(['app_open', 'card_view', 'subscribe']);
app.post('/api/events', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{ type: string; listing_id?: number }>().catch(() => null);
  if (!body || !EVENT_TYPES.has(body.type)) return c.json({ error: 'bad event' }, 400);
  if (body.type === 'app_open') c.executionCtx.waitUntil(upsertUser(c.env, user));
  await logEvent(c.env, body.type, user.id, body.listing_id ?? null);
  return c.json({ ok: true });
});

app.post('/api/buy', async (c) => {
  const user = c.get('user')!;
  const { listing_id } = await c.req.json<{ listing_id: number }>();
  const l = await getListingRow(c.env, listing_id);
  if (!l) return c.json({ error: 'not found' }, 404);
  await logEvent(c.env, 'buy_click', user.id, l.id);
  c.executionCtx.waitUntil(sendBuyRequest(c.env, l, user));
  const text = `Здравствуйте! Хочу ${listingTitle(l)}${l.price_rub ? ` за ${formatPrice(l.price_rub)}` : ''} (пост ${l.channel_msg_id})`;
  return c.json({ ok: true, text, url: `https://t.me/${STORE.sellerUsername}?text=${encodeURIComponent(text)}` });
});

app.get('/api/subscriptions', async (c) => c.json({ items: await listSubscriptions(c.env, c.get('user')!.id) }));

app.post('/api/subscriptions', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<{ family: string; storage_gb?: number | null; max_price?: number | null }>();
  if (!b.family) return c.json({ error: 'family required' }, 400);
  await c.env.DB.prepare(
    'INSERT INTO subscriptions (tg_user_id, family, storage_gb, max_price, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(user.id, b.family, b.storage_gb || null, b.max_price || null, now())
    .run();
  await logEvent(c.env, 'subscribe', user.id);
  c.executionCtx.waitUntil(upsertUser(c.env, user));
  return c.json({ items: await listSubscriptions(c.env, user.id) });
});

app.delete('/api/subscriptions/:id', async (c) => {
  const user = c.get('user')!;
  await c.env.DB.prepare('UPDATE subscriptions SET active = 0 WHERE id = ? AND tg_user_id = ?')
    .bind(+c.req.param('id'), user.id)
    .run();
  return c.json({ items: await listSubscriptions(c.env, user.id) });
});

// ——— Админка для импорта (ключ в секрете ADMIN_API_KEY) ———
app.use('/admin/*', async (c, next) => {
  if (!c.env.ADMIN_API_KEY || c.req.header('x-admin-key') !== c.env.ADMIN_API_KEY) return c.json({ error: 'forbidden' }, 403);
  await next();
});
app.post('/admin/import', async (c) => c.json(await importChannel(c.env, c.req.query('channel') || STORE.channel, num(c.req.query('pages')) ?? 3)));
app.post('/admin/media', async (c) => c.json(await downloadPending(c.env, 35)));
app.post('/admin/reviews', async (c) => c.json(await importReviews(c.env)));
app.post('/admin/check', async (c) => c.json(await checkDeleted(c.env)));
app.post('/admin/purge', async (c) => c.json(await purgeSoldMedia(c.env, num(c.req.query('days')) ?? 7)));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 7 * * 1') {
      ctx.waitUntil(sendWeeklyStats(env));
      return;
    }
    ctx.waitUntil(
      (async () => {
        await checkDeleted(env);
        await downloadPending(env, 20);
        await purgeSoldMedia(env);
        await env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(now() - 90 * 86400).run();
        await env.DB.prepare('DELETE FROM media WHERE listing_id IS NULL AND created_at < ?').bind(now() - 86400).run();
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
