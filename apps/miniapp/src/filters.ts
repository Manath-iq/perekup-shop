import type { Listing } from '@vitrina/core/types';

export type Sort = 'new' | 'cheap' | 'expensive' | 'battery';

export interface Filters {
  category: string | null;
  model_id: string | null;
  storages: number[];
  priceMin: number | null;
  priceMax: number | null;
  batteryMin: number | null;
  conditions: string[];
  sim: 'any' | 'physical' | 'esim';
  sort: Sort;
}

export const EMPTY: Filters = {
  category: null,
  model_id: null,
  storages: [],
  priceMin: null,
  priceMax: null,
  batteryMin: null,
  conditions: [],
  sim: 'any',
  sort: 'new',
};

export const SORT_LABELS: Record<Sort, string> = {
  new: 'Сначала новые',
  cheap: 'Сначала дешевле',
  expensive: 'Сначала дороже',
  battery: 'АКБ выше',
};

/** Сколько фильтров из шторки включено — для бейджа на кнопке */
export const sheetCount = (f: Filters) =>
  (f.storages.length ? 1 : 0) +
  (f.priceMin !== null || f.priceMax !== null ? 1 : 0) +
  (f.batteryMin ? 1 : 0) +
  (f.conditions.length ? 1 : 0) +
  (f.sim !== 'any' ? 1 : 0);

const BY: Record<Sort, (a: Listing, b: Listing) => number> = {
  new: (a, b) => b.created_at - a.created_at,
  cheap: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  expensive: (a, b) => (b.price ?? 0) - (a.price ?? 0),
  battery: (a, b) => (b.attrs.battery_pct ?? 0) - (a.attrs.battery_pct ?? 0),
};

export function applyFilters(items: Listing[], f: Filters, skip: { model?: boolean } = {}): Listing[] {
  const out = items.filter((l) => {
    const a = l.attrs;
    return (
      (!f.category || l.category === f.category) &&
      (skip.model || !f.model_id || l.model_id === f.model_id) &&
      (!f.storages.length || (a.storage_gb !== undefined && f.storages.includes(a.storage_gb))) &&
      (f.priceMin === null || (l.price ?? 0) >= f.priceMin) &&
      (f.priceMax === null || (l.price ?? 0) <= f.priceMax) &&
      (!f.batteryMin || (a.battery_pct ?? 0) >= f.batteryMin) &&
      (!f.conditions.length || (a.condition !== undefined && f.conditions.includes(a.condition))) &&
      (f.sim === 'any' || (f.sim === 'physical' ? a.physical_sim === true : a.physical_sim === false))
    );
  });
  return out.sort(BY[f.sort]);
}

export const sortItems = (items: Listing[], sort: Sort) => [...items].sort(BY[sort]);

export const isNew = (l: Listing) => Date.now() / 1000 - l.created_at < 48 * 3600;

/** Цвет точки АКБ: зелёный от 85%, жёлтый от 80%, дальше нейтральный */
export function batteryTone(pct: number | undefined): string {
  if (pct === undefined) return 'var(--muted)';
  if (pct >= 85) return '#3ddc84';
  if (pct >= 80) return '#f5c542';
  return '#a1a1aa';
}

export function batteryWord(pct: number): string {
  if (pct >= 90) return 'Почти как новый';
  if (pct >= 85) return 'Отличная ёмкость';
  if (pct >= 80) return 'Хорошая ёмкость';
  return 'Стоит учесть';
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  if (s < 2 * 86400) return 'вчера';
  return `${Math.round(s / 86400)} ${plural(Math.round(s / 86400), 'день', 'дня', 'дней')} назад`;
}

/** «128 ГБ · Отличное» — подпись под названием в сетке */
export function cardMeta(l: Listing): string {
  const a = l.attrs;
  const gb = a.storage_gb ? (a.storage_gb >= 1024 ? `${a.storage_gb / 1024} ТБ` : `${a.storage_gb} ГБ`) : null;
  return [gb, a.chip, a.condition].filter(Boolean).join(' · ');
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
