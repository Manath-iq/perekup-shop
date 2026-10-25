export type ListingStatus = 'active' | 'sold' | 'hidden';

/** Результат разбора текста поста. Поля, которые не нашлись, — null. */
export interface ParsedPost {
  category: 'iphone' | 'other';
  model_raw: string | null;
  family: string | null;
  storage_gb: number | null;
  status: ListingStatus;
  condition: string | null;
  sim: string | null;
  has_physical_sim: boolean | null;
  battery_pct: number | null;
  battery_cycles: number | null;
  ios: string | null;
  pluses: string[];
  nuances: string[];
  kit: string | null;
  full_kit: boolean;
  price_rub: number | null;
  /** true, если регулярки нашли модель, память и цену */
  parse_ok: boolean;
}

export interface MediaItem {
  id: number;
  kind: 'photo' | 'video';
  url: string;
  width: number | null;
  height: number | null;
  position: number;
}

/** Карточка, как её отдаёт API мини-аппу */
export interface Listing {
  id: number;
  channel_msg_id: number;
  family: string | null;
  model_raw: string | null;
  storage_gb: number | null;
  condition: string | null;
  sim: string | null;
  has_physical_sim: boolean | null;
  battery_pct: number | null;
  battery_cycles: number | null;
  ios: string | null;
  pluses: string[];
  nuances: string[];
  kit: string | null;
  full_kit: boolean;
  price_rub: number | null;
  old_price_rub: number | null;
  status: ListingStatus;
  post_url: string;
  created_at: number;
  cover: string | null;
  media?: MediaItem[];
}

export interface Facets {
  total: number;
  families: { family: string; count: number }[];
  storages: number[];
  conditions: string[];
  price_min: number;
  price_max: number;
}

export interface Subscription {
  id: number;
  family: string;
  storage_gb: number | null;
  max_price: number | null;
  created_at: number;
}
