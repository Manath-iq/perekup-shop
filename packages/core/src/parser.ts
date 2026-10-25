import type { ParsedPost } from './types';

export const ACTIVE_TAG = '#АКТУАЛЬНО_RaXi';

const MODEL_RE =
  /iPhone\s*(1[1-7]e?|SE(?:\s*\d{4})?|XS(?:\s*Max)?|XR|X)\s*(Pro\s*Max|Pro|Plus|mini|Air|Max)?/i;
const STORAGE_RE = /(\d{2,4})\s*(GB|ГБ|TB|ТБ)/i;
const BATTERY_RE = /акб\D{0,5}(\d{2,3})\s*%(?:\s*\((\d+)\s*ц)?/i;
const IOS_RE = /\bios\s*(\d{1,2}(?:\.\d{1,2}){0,2})/i;
const PRICE_RE = /💰\s*([\d\s  .]+)/;
const CONDITION_RE = /Состояние\s*:\s*([^\n]+)/i;

const PLUS_MARK = /^\s*(✅|☑️|✔️)\s*/;
const NUANCE_MARK = /^\s*(✖️|✖|❌|⚠️|❗️|❗)\s*/;

const cleanLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** «Около идеал 🔥» → «Около идеал»: текст до эмодзи, с заглавной */
function normalizeCondition(raw: string): string {
  const text = raw.replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
  if (!text) return raw.trim();
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function normalizeVariant(v: string | undefined): string {
  if (!v) return '';
  const low = v.toLowerCase().replace(/\s+/g, ' ');
  if (low === 'pro max') return 'Pro Max';
  if (low === 'pro') return 'Pro';
  if (low === 'plus') return 'Plus';
  if (low === 'mini') return 'mini';
  if (low === 'air') return 'Air';
  if (low === 'max') return 'Max';
  return v;
}

export function parseModel(line: string): { model_raw: string; family: string } | null {
  const m = line.match(MODEL_RE);
  if (!m) return null;
  const num = m[1].toUpperCase().replace(/^(\d+)E$/, '$1e').replace(/\s+/g, ' ');
  const variant = normalizeVariant(m[2]);
  const family = [num, variant].filter(Boolean).join(' ');
  return { model_raw: cleanLine(m[0]), family };
}

export function parsePost(text: string): ParsedPost {
  const lines = text.split('\n').map((l) => l.replace(/ /g, ' '));
  const titleLine = lines.find((l) => /📱|iPhone/i.test(l)) ?? '';

  const model = parseModel(titleLine) ?? parseModel(text);
  const storageMatch = titleLine.match(STORAGE_RE) ?? text.match(STORAGE_RE);
  let storage_gb: number | null = null;
  if (storageMatch) {
    const n = parseInt(storageMatch[1], 10);
    storage_gb = /T/i.test(storageMatch[2]) ? n * 1024 : n;
  }
  // «1TB» в коротком виде: 1 цифра не ловится общим RE
  if (storage_gb === null) {
    const tb = (titleLine || text).match(/(\d)\s*(TB|ТБ)/i);
    if (tb) storage_gb = parseInt(tb[1], 10) * 1024;
  }

  const status = text.includes(ACTIVE_TAG) ? 'active' : 'sold';

  const condMatch = text.match(CONDITION_RE);
  const condition = condMatch ? normalizeCondition(condMatch[1]) : null;

  let sim: string | null = null;
  let has_physical_sim: boolean | null = null;
  for (const l of lines) {
    if (/sim/i.test(l) && !PLUS_MARK.test(l) && !NUANCE_MARK.test(l)) {
      sim = cleanLine(l);
      const low = sim.toLowerCase();
      has_physical_sim = /2\s*sim|nano|sim\s*\+|\+\s*sim|физ/.test(low) || !/esim/.test(low);
      break;
    }
  }

  const bat = text.match(BATTERY_RE);
  const battery_pct = bat ? Math.min(100, parseInt(bat[1], 10)) : null;
  const battery_cycles = bat?.[2] ? parseInt(bat[2], 10) : null;
  const iosMatch = text.match(IOS_RE);
  const ios = iosMatch ? iosMatch[1] : null;

  const pluses: string[] = [];
  const nuances: string[] = [];
  let kit: string | null = null;
  let full_kit = false;

  for (const raw of lines) {
    const isPlus = PLUS_MARK.test(raw);
    const isNuance = !isPlus && NUANCE_MARK.test(raw) && !/продано/i.test(raw);
    if (!isPlus && !isNuance) continue;
    const body = cleanLine(raw.replace(isPlus ? PLUS_MARK : NUANCE_MARK, ''));
    if (!body) continue;

    if (/^полный комплект/i.test(body)) {
      kit = 'Полный комплект';
      full_kit = true;
    } else if (/^комплект\s*:/i.test(body)) {
      kit = cleanLine(body.replace(/^комплект\s*:/i, ''));
    }
    // АКБ и iOS уже разобраны в отдельные поля
    if (isPlus && (BATTERY_RE.test(body) || /^ios\s*\d/i.test(body))) continue;
    (isPlus ? pluses : nuances).push(body);
  }

  const priceMatch = text.match(PRICE_RE);
  const priceDigits = priceMatch ? priceMatch[1].replace(/\D/g, '') : '';
  const price_rub = priceDigits ? parseInt(priceDigits, 10) : null;

  const isIphone = !!model;
  return {
    category: isIphone ? 'iphone' : 'other',
    model_raw: model?.model_raw ?? (cleanLine(titleLine.replace('📱', '')) || null),
    family: model?.family ?? null,
    storage_gb,
    status,
    condition,
    sim,
    has_physical_sim,
    battery_pct,
    battery_cycles,
    ios,
    pluses,
    nuances,
    kit,
    full_kit,
    price_rub,
    parse_ok: !!(model && storage_gb && price_rub),
  };
}

/** Похоже ли сообщение на карточку товара (иначе — анонс/отзыв, игнорируем) */
export function isListingPost(text: string): boolean {
  return text.includes(ACTIVE_TAG);
}

export const formatPrice = (rub: number) =>
  rub.toLocaleString('ru-RU').replace(/ | /g, ' ') + ' ₽';

export const formatStorage = (gb: number) => (gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`);

export const listingTitle = (l: { family: string | null; model_raw: string | null; storage_gb: number | null }) =>
  `${l.family ? 'iPhone ' + l.family : l.model_raw ?? 'Телефон'}${l.storage_gb ? ' ' + formatStorage(l.storage_gb) : ''}`;
