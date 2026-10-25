import { Api, InlineKeyboard } from 'grammy';
import { formatPrice, listingTitle } from '@vitrina/core/parser';
import type { Env } from './env';
import { adminIds, now } from './env';
import type { ListingRow } from './db';

export const api = (env: Env) => new Api(env.BOT_TOKEN);

export const cardUrl = (origin: string, id: number) => `${origin}/?l=${id}`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function shortLine(l: ListingRow): string {
  const parts = [listingTitle(l)];
  if (l.battery_pct) parts.push(`АКБ ${l.battery_pct}%`);
  if (l.price_rub) parts.push(formatPrice(l.price_rub));
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

/** Превью новой карточки продавцу с кнопками подтверждения */
export async function sendAdminPreview(env: Env, origin: string, l: ListingRow) {
  const nuances: string[] = JSON.parse(l.nuances);
  const lines = [
    l.parse_ok ? '🆕 <b>Новая карточка в каталоге</b>' : '⚠️ <b>Проверьте карточку</b> — пост разобран не полностью',
    '',
    `<b>${esc(listingTitle(l))}</b> — ${l.price_rub ? formatPrice(l.price_rub) : 'цена не найдена'}`,
    [l.condition, l.battery_pct && `АКБ ${l.battery_pct}%`, l.sim].filter(Boolean).map((s) => esc(String(s))).join(' · '),
    nuances.length ? `Нюансы: ${esc(nuances.join('; '))}` : '',
    '',
    `<a href="${l.post_url}">Пост в канале</a> · id ${l.id}`,
  ].filter((s, i, a) => s !== '' || a[i - 1] !== '');
  const kb = new InlineKeyboard()
    .text('✅ Всё верно', `ok:${l.id}`)
    .text('🙈 Скрыть', `hide:${l.id}`)
    .row()
    .webApp('Открыть в каталоге', cardUrl(origin, l.id));
  await toAdmins(env, lines.join('\n'), kb);
}

export async function sendBuyRequest(env: Env, l: ListingRow, user: { id: number; username?: string; first_name?: string }) {
  const who = user.username ? `@${esc(user.username)}` : `<a href="tg://user?id=${user.id}">${esc(user.first_name ?? 'Покупатель')}</a>`;
  await toAdmins(env, `🛒 ${who} нажал «Купить»: <b>${esc(listingTitle(l))}</b>${l.price_rub ? ', ' + formatPrice(l.price_rub) : ''}\n<a href="${l.post_url}">Пост в канале</a>`);
}

/** Разослать новую карточку подписчикам, у которых совпали модель, память и потолок цены */
export async function notifySubscribers(env: Env, origin: string, l: ListingRow) {
  if (l.status !== 'active' || !l.family) return;
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.tg_user_id FROM subscriptions s
     WHERE s.active = 1 AND s.family = ?
       AND (s.storage_gb IS NULL OR s.storage_gb = ?)
       AND (s.max_price IS NULL OR ? <= s.max_price)
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.listing_id = ? AND n.tg_user_id = s.tg_user_id)`,
  )
    .bind(l.family, l.storage_gb, l.price_rub ?? 0, l.id)
    .all<{ tg_user_id: number }>();
  const kb = new InlineKeyboard().webApp('Открыть карточку', cardUrl(origin, l.id));
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

export async function statsText(env: Env, days = 7): Promise<string> {
  const since = now() - days * 86400;
  const { results } = await env.DB.prepare(
    `SELECT type, COUNT(*) AS c, COUNT(DISTINCT tg_user_id) AS u FROM events WHERE created_at >= ? GROUP BY type`,
  )
    .bind(since)
    .all<{ type: string; c: number; u: number }>();
  const by = Object.fromEntries(results.map((r) => [r.type, r]));
  const top = await env.DB.prepare(
    `SELECT l.family, l.storage_gb, COUNT(*) AS c FROM events e JOIN listings l ON l.id = e.listing_id
     WHERE e.type = 'card_view' AND e.created_at >= ? GROUP BY l.family ORDER BY c DESC LIMIT 3`,
  )
    .bind(since)
    .all<{ family: string; c: number }>();
  const active = await env.DB.prepare(`SELECT COUNT(*) AS c FROM listings WHERE status = 'active'`).first<{ c: number }>();
  const sold = await env.DB.prepare(`SELECT COUNT(*) AS c FROM listings WHERE sold_at >= ?`).bind(since).first<{ c: number }>();
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
    top.results.length ? `\nТоп моделей по просмотрам:\n${top.results.map((t, i) => `${i + 1}. iPhone ${esc(t.family)} — ${t.c}`).join('\n')}` : '',
  ].join('\n');
}

export async function sendWeeklyStats(env: Env) {
  await toAdmins(env, await statsText(env));
}
