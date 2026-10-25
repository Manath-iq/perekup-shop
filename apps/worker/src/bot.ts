import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Message, UserFromGetMe } from 'grammy/types';
import { formatPrice, listingTitle } from '@vitrina/core/parser';
import type { Env } from './env';
import { adminIds, now } from './env';
import type { ListingRow } from './db';
import { addMedia, downloadPending, setStatus, upsertPost } from './ingest';
import { notifySubscribers, sendAdminPreview, statsText } from './notify';
import { STORE } from './config';

interface Deps {
  env: Env;
  origin: string;
  waitUntil: (p: Promise<unknown>) => void;
}

const postUrl = (chat: Message['chat'], id: number) =>
  'username' in chat && chat.username
    ? `https://t.me/${chat.username}/${id}`
    : `https://t.me/c/${String(chat.id).replace(/^-100/, '')}/${id}`;

const channelKey = (chat: Message['chat']) => ('username' in chat && chat.username ? chat.username : String(chat.id));

export function createBot({ env, origin, waitUntil }: Deps) {
  const botInfo = {
    id: +env.BOT_TOKEN.split(':')[0],
    is_bot: true,
    first_name: STORE.name,
    username: env.BOT_USERNAME,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as UserFromGetMe;
  const bot = new Bot(env.BOT_TOKEN, { botInfo });
  const admins = adminIds(env);
  const isAdmin = (ctx: Context) => !!ctx.from && admins.includes(ctx.from.id);
  const catalogKb = () => new InlineKeyboard().webApp('📱 Открыть каталог', origin);

  // ——— Канал: новые посты и правки ———
  async function handleChannelMessage(msg: Message, edited: boolean) {
    const channel = channelKey(msg.chat);
    const text = msg.caption ?? msg.text ?? '';
    const group = msg.media_group_id ?? null;

    if (msg.photo?.length) {
      const big = msg.photo[msg.photo.length - 1];
      await addMedia(env, {
        channel, msg_id: msg.message_id, media_group_id: group, kind: 'photo',
        source: `tg:${big.file_id}`, file_size: big.file_size, width: big.width, height: big.height,
      });
    }
    if (msg.video) {
      await addMedia(env, {
        channel, msg_id: msg.message_id, media_group_id: group, kind: 'video',
        source: `tg:${msg.video.file_id}`, file_size: msg.video.file_size, width: msg.video.width, height: msg.video.height,
      });
    }

    if (text) {
      const res = await upsertPost(env, {
        channel, msg_id: msg.message_id, text, media_group_id: group,
        date: edited ? msg.date : msg.date || now(), post_url: postUrl(msg.chat, msg.message_id),
      });
      if (res?.created && res.listing.status === 'active') {
        waitUntil(sendAdminPreview(env, origin, res.listing));
        waitUntil(notifySubscribers(env, origin, res.listing));
      }
    }
    // качаем файлы в фоне, чтобы быстро ответить Telegram
    waitUntil(downloadPending(env, 12));
  }

  bot.on('channel_post', (ctx) => handleChannelMessage(ctx.channelPost, false));
  bot.on('edited_channel_post', (ctx) => handleChannelMessage(ctx.editedChannelPost, true));

  // ——— Покупатель ———
  bot.command('start', async (ctx) => {
    // ссылка «Поделиться» из карточки: t.me/<бот>?start=l_12
    const shared = ctx.match.match(/^l_(\d+)$/);
    if (shared) {
      const l = await env.DB.prepare(`SELECT * FROM listings WHERE id = ? AND status = 'active'`).bind(+shared[1]).first<ListingRow>();
      if (l) {
        return ctx.reply(`📱 <b>${listingTitle(l)}</b>${l.price_rub ? ' — ' + formatPrice(l.price_rub) : ''}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().webApp('Открыть карточку', `${origin}/?l=${l.id}`).row().webApp('Весь каталог', origin),
        });
      }
    }
    await ctx.reply(
      `Здравствуйте! Это каталог <b>${STORE.name}</b> — только телефоны, которые есть в наличии прямо сейчас.\n\nВыберите модель, посмотрите фото и характеристики и напишите продавцу в один тап.`,
      { parse_mode: 'HTML', reply_markup: catalogKb() },
    );
    if (isAdmin(ctx)) {
      await ctx.reply('Вы админ. Команды: /list, /stats, /sold id, /hide id, /show id');
    }
  });

  // ——— Продавец ———
  bot.command('list', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { results } = await env.DB.prepare(
      `SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC`,
    ).all<ListingRow>();
    if (!results.length) return ctx.reply('Активных карточек нет.');
    const lines = results.map((l) => {
      const days = Math.max(0, Math.floor((now() - l.created_at) / 86400));
      return `<code>${l.id}</code> ${listingTitle(l)} — ${l.price_rub ? formatPrice(l.price_rub) : '?'} · ${days} дн.${l.parse_ok ? '' : ' ⚠️'}`;
    });
    await ctx.reply(`<b>В наличии: ${results.length}</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply(await statsText(env), { parse_mode: 'HTML' });
  });

  for (const [cmd, status, done] of [
    ['sold', 'sold', 'снята как проданная'],
    ['hide', 'hidden', 'скрыта'],
    ['show', 'active', 'снова в каталоге'],
  ] as const) {
    bot.command(cmd, async (ctx) => {
      if (!isAdmin(ctx)) return;
      const id = parseInt(ctx.match, 10);
      if (!id) return ctx.reply(`Укажите id карточки: /${cmd} 12. Список — /list`);
      const l = await setStatus(env, id, status);
      await ctx.reply(l ? `${listingTitle(l)} — ${done}.` : 'Карточка не найдена.');
    });
  }

  bot.callbackQuery(/^(ok|hide):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery();
    const [, action, idStr] = ctx.match;
    const id = +idStr;
    if (action === 'ok') {
      await env.DB.prepare('UPDATE listings SET confirmed = 1, parse_ok = 1 WHERE id = ?').bind(id).run();
      await ctx.answerCallbackQuery('Отлично, карточка в каталоге');
    } else {
      await setStatus(env, id, 'hidden');
      await ctx.answerCallbackQuery('Скрыто. Вернуть: /show ' + id);
    }
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().webApp(action === 'ok' ? '✅ Подтверждено · открыть' : '🙈 Скрыто · открыть', `${origin}/?l=${id}`),
    }).catch(() => {});
  });

  // Всё остальное — кнопка каталога
  bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await ctx.reply('Все телефоны в наличии — в каталоге 👇', { reply_markup: catalogKb() });
  });

  bot.catch((err) => console.error('bot error', err.error));
  return bot;
}
