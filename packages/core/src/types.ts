import type { Attrs, Category } from './catalog';

export type ListingStatus = 'active' | 'reserved' | 'sold' | 'hidden';

export interface MediaItem {
  id: number;
  kind: 'photo' | 'video';
  url: string;
  /** Кадр-превью видео */
  poster: string | null;
  width: number | null;
  height: number | null;
  position: number;
}

/**
 * Поля карточки в форме прототипа RaXi. Мини-апп читает их до переделки на этапе 3,
 * после — удалить вместе с заполнением в worker/src/db.ts.
 */
export interface LegacyListingFields {
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
  kit: string | null;
  full_kit: boolean;
  price_rub: number | null;
  old_price_rub: number | null;
}

/** Карточка, как её отдаёт API мини-аппу */
export interface Listing extends LegacyListingFields {
  id: number;
  msg_id: number;
  category: Category;
  brand: string | null;
  model_id: string | null;
  /** Линейка и короткое имя: «iPhone» + «15 Pro Max» */
  line: string | null;
  short: string | null;
  title: string;
  price: number | null;
  old_price: number | null;
  attrs: Attrs;
  pluses: string[];
  nuances: string[];
  status: ListingStatus;
  post_url: string;
  created_at: number;
  cover: string | null;
  /** Крошечное превью обложки (data: URI) — размытая подложка, пока грузится картинка */
  cover_blur: string | null;
  media?: MediaItem[];
}

export interface ModelFacet {
  model_id: string;
  line: string;
  short: string;
  title: string;
  category: Category;
  count: number;
  min_price: number | null;
}

export interface Facets {
  total: number;
  categories: { category: Category; title: string; count: number }[];
  models: ModelFacet[];
  /** Для мини-аппа прототипа: короткие имена моделей */
  families: { family: string; count: number }[];
  storages: number[];
  conditions: string[];
  price_min: number;
  price_max: number;
  /** Когда каталог последний раз сверялся с каналом: новый пост, правка или часовая проверка */
  synced_at: number | null;
}

export interface Subscription {
  id: number;
  model_id: string;
  title: string;
  /** Для мини-аппа прототипа — короткое имя модели */
  family: string;
  storage_gb: number | null;
  max_price: number | null;
  created_at: number;
}

/** Кабинет продавца: всё за выбранный период */
export interface CabinetMetric {
  value: number;
  /** То же за предыдущий такой же период — для «+18%» */
  prev: number;
}

export interface CabinetData {
  days: number;
  kpis: { app_open: CabinetMetric; card_view: CabinetMetric; buy_click: CabinetMetric; subscribe: CabinetMetric };
  in_stock: number;
  sold: number;
  /** Неуверенно разобранные карточки — покупатели их не видят до «Всё верно» */
  pending: { id: number; title: string; price: number | null; attrs: import('./catalog').Attrs; text: string; parsed_by: 'rules' | 'llm'; missing: string[]; post_url: string }[];
  /** Что ищут и ждут, а в наличии нет */
  demand: { model_id: string; title: string; storage_gb: number | null; searches: number; waiting: number }[];
  leads: { id: number; listing_id: number; title: string; price: number | null; who: string; username: string | null; status: 'new' | 'work' | 'sold'; created_at: number }[];
  top: { listing_id: number; title: string; views: number }[];
}
