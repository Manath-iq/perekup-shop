import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Message, UserFromGetMe } from 'grammy/types';
import { formatPrice, listingTitle } from '@vitrina/core/format';
import { parseStartParam } from '@vitrina/core/store';
import type { Env } from './env';
import { adminIds, now } from './env';
import type { ListingRow } from './db';
import { addMedia, downloadCovers, setStatus, upsertPost } from './ingest';
import { pickPhotoSizes } from './media';
import { cardUrl, notifyPriceDrop, notifySubscribers, sendAdminPreview, statsText, storeUrl } from './notify';
import { getStore, getStoreByChannel, listStores, type Ctx } from './store';

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

/** Пауза перед превью: фото альбома приходят отдельными апдейтами, ждём, пока соберутся */
const ALBUM_SETTLE_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createBot({ env, origin, waitUntil }: Deps) {
  const botInfo = {
    id: +env.BOT_TOKEN.split(':')[0],
    is_bot: true,
    first_name: 'Витрина',
    username: env.BOT_USERNAME,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as UserFromGetMe;
  const bot = new Bot(env.BOT_TOKEN, { botInfo });
  const admins = adminIds(env);
  const isAdmin = (ctx: Context) => !!ctx.from && admins.includes(ctx.from.id);
  /** Магазин для команд в личке: у клиентского деплоя он один */
  const ownStore = async (): Promise<Ctx | null> => {
    const store = env.STORE_ID ? await getStore(env, env.STORE_ID) : null;
    return store ? { env, store } : null;
  };

  // ——— Канал: новые посты и правки ———
  async function handleChannelMessage(msg: Message, edited: boolean) {
    const store = await getStoreByChannel(env, channelKey(msg.chat));
    if (!store) return;
    const ctx: Ctx = { env, store };
    const text = msg.caption ?? msg.text ?? '';
    const group = msg.media_group_id ?? null;

    if (msg.photo?.length) {
      const { gallery, cover, blur } = pickPhotoSizes(msg.photo);
      await addMedia(ctx, {
        msg_id: msg.message_id, media_group_id: group, kind: 'photo',
        source: `tg:${gallery.file_id}`, cover_source: `tg:${cover.file_id}`, blur_source: blur ? `tg:${blur.file_id}` : null,
        file_size: gallery.file_size, width: gallery.width, height: gallery.height,
      });
    }
    if (msg.video) {
      const v = msg.video;
      await addMedia(ctx, {
        msg_id: msg.message_id, media_group_id: group, kind: 'video',
        source: `tg:${v.file_id}`, poster_source: v.thumbnail ? `tg:${v.thumbnail.file_id}` : null,
        file_size: v.file_size, width: v.width, height: v.height,
      });
    }

    if (text) {
      const results = await upsertPost(ctx, {
        msg_id: msg.message_id, text, media_group_id: group,
        date: edited ? msg.date : msg.date || now(), post_url: postUrl(msg.chat, msg.message_id),
      });
      for (const res of results) if (res.priceChanged && res.oldPrice) waitUntil(notifyPriceDrop(ctx, origin, res.listing, res.oldPrice));
      const created = results.filter((r) => r.created);
      if (created.length) {
        waitUntil(
          (async () => {
            if (group) await sleep(ALBUM_SETTLE_MS);
            // обложку берём, когда альбом собрался, — иначе первым может оказаться не первое фото
            await downloadCovers(ctx, 1);
            // у прайса превью по первым трём строкам, чтобы не завалить продавца сообщениями
            for (const res of created.slice(0, 3)) {
              await sendAdminPreview(ctx, origin, res.listing, res.parsed.missing);
              if (res.listing.parse_ok) await notifySubscribers(ctx, origin, res.listing);
            }
            for (const res of created.slice(3)) if (res.listing.parse_ok) await notifySubscribers(ctx, origin, res.listing);
          })(),
        );
      }
    }
  }

  bot.on('channel_post', (ctx) => handleChannelMessage(ctx.channelPost, false));
  bot.on('edited_channel_post', (ctx) => handleChannelMessage(ctx.editedChannelPost, true));

  // ——— Покупатель ———
  bot.command('start', async (tg) => {
    const start = parseStartParam(tg.match);
    const own = await ownStore();
    const store = own?.store ?? (start.store ? await getStore(env, start.store) : null);
    if (!store) {
      const hint = isAdmin(tg) && !env.STORE_ID ? '\n\nВы админ демо: /demos — список демо-магазинов.' : '';
      return tg.reply(
        `Это Витрина — магазин внутри Telegram для каналов с техникой: покупатель видит только то, что есть в наличии, и пишет продавцу в один тап.\n\nОткройте ссылку на магазин, которую вам прислали.${hint}`,
      );
    }
    const ctx: Ctx = { env, store };
    if (start.listing) {
      const l = await env.DB.prepare(`SELECT * FROM listings WHERE id = ? AND store_id = ? AND status IN ('active', 'reserved')`)
        .bind(start.listing, store.id)
        .first<ListingRow>();
      if (l) {
        return tg.reply(`📱 <b>${listingTitle(l)}</b>${l.price ? ' — ' + formatPrice(l.price) : ''}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().webApp('Открыть карточку', cardUrl(ctx, origin, l.id)).row().webApp('Весь каталог', storeUrl(ctx, origin)),
        });
      }
    }
    await tg.reply(
      `Здравствуйте! Это каталог <b>${store.config.name}</b> — только то, что есть в наличии прямо сейчас.\n\nВыберите модель, посмотрите фото и характеристики и напишите продавцу в один тап.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('📱 Открыть каталог', storeUrl(ctx, origin)) },
    );
    if (isAdmin(tg) && own) await tg.reply('Вы админ. Команды: /list, /stats, /sold id, /hide id, /show id');
  });

  // ——— Продавец ———
  bot.command('list', async (tg) => {
    const ctx = await ownStore();
    if (!isAdmin(tg) || !ctx) return;
    const { results } = await env.DB.prepare(
      `SELECT * FROM listings WHERE store_id = ? AND status IN ('active', 'reserved') ORDER BY created_at DESC`,
    )
      .bind(ctx.store.id)
      .all<ListingRow>();
    if (!results.length) return tg.reply('Активных карточек нет.');
    const lines = results.map((l) => {
      const days = Math.max(0, Math.floor((now() - l.created_at) / 86400));
      const flags = `${l.status === 'reserved' ? ' 🔒' : ''}${l.parse_ok || l.confirmed ? '' : ' ⚠️'}`;
      return `<code>${l.id}</code> ${listingTitle(l)} — ${l.price ? formatPrice(l.price) : '?'} · ${days} дн.${flags}`;
    });
    await tg.reply(`<b>В наличии: ${results.length}</b>\n\n${lines.join('\n')}\n\n⚠️ — ждёт «Всё верно»`, { parse_mode: 'HTML' });
  });

  // Демо-деплой: список магазинов со ссылками — чтобы быстро открыть или переслать перекупу
  bot.command('demos', async (tg) => {
    if (!isAdmin(tg) || env.STORE_ID) return;
    const stores = (await listStores(env)).filter((s) => s.kind === 'demo');
    if (!stores.length) return tg.reply('Демо пока нет. Создайте: npm run cli -- demo <канал>');
    const lines = stores.map((s) => {
      const days = s.expires_at ? Math.max(0, Math.ceil((s.expires_at - now()) / 86400)) : null;
      return `<b>${s.config.name}</b> · @${s.channel}${days !== null ? ` · ещё ${days} дн.` : ''}\nhttps://t.me/${env.BOT_USERNAME}?start=${s.id}`;
    });
    await tg.reply(lines.join('\n\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('stats', async (tg) => {
    const ctx = await ownStore();
    if (!isAdmin(tg) || !ctx) return;
    await tg.reply(await statsText(ctx), { parse_mode: 'HTML' });
  });

  for (const [cmd, status, done] of [
    ['sold', 'sold', 'снята как проданная'],
    ['hide', 'hidden', 'скрыта'],
    ['show', 'active', 'снова в каталоге'],
    ['reserve', 'reserved', 'забронирована'],
  ] as const) {
    bot.command(cmd, async (tg) => {
      const ctx = await ownStore();
      if (!isAdmin(tg) || !ctx) return;
      const id = parseInt(tg.match, 10);
      if (!id) return tg.reply(`Укажите id карточки: /${cmd} 12. Список — /list`);
      const l = await setStatus(ctx, id, status);
      await tg.reply(l ? `${listingTitle(l)} — ${done}.` : 'Карточка не найдена.');
    });
  }

  bot.callbackQuery(/^(ok|hide):(\d+)$/, async (tg) => {
    const ctx = await ownStore();
    if (!isAdmin(tg) || !ctx) return tg.answerCallbackQuery();
    const [, action, idStr] = tg.match;
    const id = +idStr;
    if (action === 'ok') {
      const l = await env.DB.prepare('UPDATE listings SET confirmed = 1 WHERE id = ? AND store_id = ? RETURNING *').bind(id, ctx.store.id).first<ListingRow>();
      await tg.answerCallbackQuery('Отлично, карточка в каталоге');
      // неуверенная карточка до подтверждения была скрыта — подписчики узнают о ней только сейчас
      if (l && !l.parse_ok) waitUntil(notifySubscribers(ctx, origin, l));
    } else {
      await setStatus(ctx, id, 'hidden');
      await tg.answerCallbackQuery('Скрыто. Вернуть: /show ' + id);
    }
    await tg
      .editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().webApp(action === 'ok' ? '✅ Подтверждено · открыть' : '🙈 Скрыто · открыть', cardUrl(ctx, origin, id)),
      })
      .catch(() => {});
  });

  // Всё остальное — кнопка каталога
  bot.on('message', async (tg) => {
    if (tg.chat.type !== 'private') return;
    const ctx = await ownStore();
    if (!ctx) return;
    await tg.reply('Всё, что есть в наличии, — в каталоге 👇', { reply_markup: new InlineKeyboard().webApp('📱 Открыть каталог', storeUrl(ctx, origin)) });
  });

  bot.catch((err) => console.error('bot error', err.error));
  return bot;
}
