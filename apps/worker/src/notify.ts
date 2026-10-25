import { Api, InlineKeyboard } from 'grammy';
import { formatPrice, listingTitle } from '@vitrina/core/format';
import type { Attrs } from '@vitrina/core/catalog';
import type { Env } from './env';
import { adminIds, now } from './env';
import type { Ctx } from './store';
import type { ListingRow } from './db';

export const api = (env: Env) => new Api(env.BOT_TOKEN);

/** Ссылка для кнопки web_app: у демо-деплоя в ней ещё и магазин (`?s=`), у клиента он один */
export const storeUrl = (ctx: Ctx, origin: string) => (ctx.env.STORE_ID ? `${origin}/` : `${origin}/?s=${ctx.store.id}`);

export const cardUrl = (ctx: Ctx, origin: string, id: number) => `${storeUrl(ctx, origin)}${ctx.env.STORE_ID ? '?' : '&'}l=${id}`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const attrsOf = (l: ListingRow): Attrs => JSON.parse(l.attrs);

export function shortLine(l: ListingRow): string {
  const parts = [listingTitle(l)];
  if (l.battery_pct) parts.push(`АКБ ${l.battery_pct}%`);
  if (l.price) parts.push(formatPrice(l.price));
  return parts.join(', ');
}

async function toAdmins(env: Env, text: string, keyboard?: InlineKeyboard) {
  await Promise.all(
    adminIds(env).map((id) =>
      api(env)
        .sendMessage(id, text, { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } })
        .catch((e) => console.warn('admin send failed', id, String(e))),
    ),
  );
}

const MISSING_LABELS: Record<string, string> = { model: 'модель', price: 'цена', storage_gb: 'память' };

/** Превью новой карточки продавцу. Неуверенная карточка не видна покупателям, пока продавец не подтвердит. */
export async function sendAdminPreview(ctx: Ctx, origin: string, l: ListingRow, missing: string[] = []) {
  const a = attrsOf(l);
  const nuances: string[] = JSON.parse(l.nuances);
  const ok = !!l.parse_ok;
  const lines = [
    ok ? '🆕 <b>Новая карточка в каталоге</b>' : '⚠️ <b>Проверьте карточку</b> — покупатели увидят её после «Всё верно»',
    '',
    `<b>${esc(listingTitle(l))}</b> — ${l.price ? formatPrice(l.price) : 'цена не найдена'}`,
    [a.condition, a.battery_pct && `АКБ ${a.battery_pct}%`, a.sim, a.chip].filter(Boolean).map((s) => esc(String(s))).join(' · '),
    nuances.length ? `Нюансы: ${esc(nuances.join('; '))}` : '',
    !ok && missing.length ? `Не нашлось: ${missing.map((m) => MISSING_LABELS[m] ?? m).join(', ')}` : '',
    !ok && l.parsed_by === 'llm' ? 'Разобрано нейросетью — проверьте цифры' : '',
    '',
    `<a href="${l.post_url}">Пост в канале</a> · id ${l.id}`,
  ].filter((s, i, arr) => s !== '' || arr[i - 1] !== '');
  const kb = new InlineKeyboard()
    .text('✅ Всё верно', `ok:${l.id}`)
    .text('🙈 Скрыть', `hide:${l.id}`)
    .row()
    .webApp('Открыть в каталоге', cardUrl(ctx, origin, l.id));
  await toAdmins(ctx.env, lines.join('\n'), kb);
}

export async function sendBuyRequest(ctx: Ctx, l: ListingRow, user: { id: number; username?: string; first_name?: string }) {
  const who = user.username ? `@${esc(user.username)}` : `<a href="tg://user?id=${user.id}">${esc(user.first_name ?? 'Покупатель')}</a>`;
  await toAdmins(ctx.env, `🛒 ${who} нажал «Купить»: <b>${esc(listingTitle(l))}</b>${l.price ? ', ' + formatPrice(l.price) : ''}\n<a href="${l.post_url}">Пост в канале</a>`);
}

/** Разослать новую карточку подписчикам, у которых совпали модель, память и потолок цены */
export async function notifySubscribers(ctx: Ctx, origin: string, l: ListingRow) {
  const { env } = ctx;
  if (l.status !== 'active' || !l.model_id) return;
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.tg_user_id FROM subscriptions s
     WHERE s.store_id = ? AND s.active = 1 AND s.model_id = ?
       AND (s.storage_gb IS NULL OR s.storage_gb = ?)
       AND (s.max_price IS NULL OR ? <= s.max_price)
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.listing_id = ? AND n.tg_user_id = s.tg_user_id)`,
  )
    .bind(l.store_id, l.model_id, l.storage_gb, l.price ?? 0, l.id)
    .all<{ tg_user_id: number }>();
  const kb = new InlineKeyboard().webApp('Открыть карточку', cardUrl(ctx, origin, l.id));
  for (const { tg_user_id } of results) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO notifications (listing_id, tg_user_id, sent_at) VALUES (?, ?, ?)')
      .bind(l.id, tg_user_id, now())
      .run();
    if (!r.meta.changes) continue;
    await api(env)
      .sendMessage(tg_user_id, `🔔 Появился ${esc(shortLine(l))}`, { parse_mode: 'HTML', reply_markup: kb })
      .catch((e) => console.warn('notify failed', tg_user_id, String(e)));
  }
}

export async function statsText({ env, store }: Ctx, days = 7): Promise<string> {
  const since = now() - days * 86400;
  const { results } = await env.DB.prepare(
    `SELECT type, COUNT(*) AS c, COUNT(DISTINCT tg_user_id) AS u FROM events WHERE store_id = ? AND created_at >= ? GROUP BY type`,
  )
    .bind(store.id, since)
    .all<{ type: string; c: number; u: number }>();
  const by = Object.fromEntries(results.map((r) => [r.type, r]));
  const top = await env.DB.prepare(
    `SELECT l.title, COUNT(*) AS c FROM events e JOIN listings l ON l.id = e.listing_id
     WHERE e.store_id = ? AND e.type = 'card_view' AND e.created_at >= ? GROUP BY l.model_id ORDER BY c DESC LIMIT 3`,
  )
    .bind(store.id, since)
    .all<{ title: string; c: number }>();
  const active = await env.DB.prepare(`SELECT COUNT(*) AS c FROM listings WHERE store_id = ? AND status IN ('active', 'reserved')`)
    .bind(store.id)
    .first<{ c: number }>();
  const sold = await env.DB.prepare(`SELECT COUNT(*) AS c FROM listings WHERE store_id = ? AND sold_at >= ?`).bind(store.id, since).first<{ c: number }>();
  const n = (t: string) => by[t]?.c ?? 0;
  return [
    `📊 <b>Статистика за ${days} дней</b>`,
    '',
    `Открытий каталога: <b>${n('app_open')}</b> (${by.app_open?.u ?? 0} чел.)`,
    `Просмотров карточек: <b>${n('card_view')}</b>`,
    `Нажатий «Купить»: <b>${n('buy_click')}</b> (${by.buy_click?.u ?? 0} чел.)`,
    `Новых подписок: <b>${n('subscribe')}</b>`,
    '',
    `В наличии сейчас: ${active?.c ?? 0} · продано за период: ${sold?.c ?? 0}`,
    top.results.length ? `\nТоп моделей по просмотрам:\n${top.results.map((t, i) => `${i + 1}. ${esc(t.title)} — ${t.c}`).join('\n')}` : '',
  ].join('\n');
}

export async function sendWeeklyStats(ctx: Ctx) {
  await toAdmins(ctx.env, await statsText(ctx));
}
