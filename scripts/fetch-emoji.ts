/**
 * Скачивает анимированные эмодзи из набора Telegram и кладёт их распакованными (Lottie JSON) в app/public/emoji.
 *   BOT_TOKEN=... node scripts/fetch-emoji.ts
 * Набор: https://t.me/addemoji/RestrictedEmoji. Добавить эмодзи — дописать строку в EMOJI.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const SET = 'RestrictedEmoji';
const EMOJI: Record<string, string> = {
  phone: '📱',
  search: '🔍',
  shrug: '🤷',
  retry: '🔄',
  bell: '🔔',
  fire: '🔥',
  star: '⭐️',
  map: '🗺',
  car: '🚗',
  check: '✅',
  money: '💸',
  megaphone: '📣',
  chat: '💬',
  party: '🎉',
  sparkles: '✨',
  gem: '💎',
};

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Нужен BOT_TOKEN');
const api = `https://api.telegram.org/bot${token}`;
const strip = (s: string) => s.replace(/️/g, '');

const set = (await (await fetch(`${api}/getStickerSet?name=${SET}`)).json()) as {
  result: { stickers: { emoji: string; file_id: string; is_animated: boolean }[] };
};
const out = new URL('../app/public/emoji/', import.meta.url);
mkdirSync(out, { recursive: true });

for (const [name, emoji] of Object.entries(EMOJI)) {
  const sticker = set.result.stickers.find((s) => s.is_animated && strip(s.emoji) === strip(emoji));
  if (!sticker) {
    console.warn(`нет в наборе: ${name} ${emoji}`);
    continue;
  }
  const file = (await (await fetch(`${api}/getFile?file_id=${sticker.file_id}`)).json()) as { result: { file_path: string } };
  const tgs = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${file.result.file_path}`)).arrayBuffer());
  const json = gunzipSync(tgs).toString('utf8');
  writeFileSync(new URL(`${name}.json`, out), JSON.stringify(JSON.parse(json)));
  console.log(`${emoji} ${name}: ${(json.length / 1024).toFixed(1)} КБ`);
}
