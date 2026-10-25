-- Схема Витрины. store_id есть везде: у клиентского деплоя один магазин, у демо — много.

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  config TEXT NOT NULL,
  profile TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'client',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX idx_stores_channel ON stores (channel);

-- Исходный текст каждого поста канала, включая не-объявления: по нему можно перепарсить всё заново
CREATE TABLE posts (
  store_id TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  media_group_id TEXT,
  text TEXT NOT NULL,
  post_url TEXT NOT NULL,
  date INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, msg_id)
);

-- storage_gb, battery_pct, condition, physical_sim — копии из attrs для фильтров и индексов
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  media_group_id TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  brand TEXT,
  model_id TEXT,
  line TEXT,
  short TEXT,
  title TEXT NOT NULL,
  price INTEGER,
  storage_gb INTEGER,
  battery_pct INTEGER,
  condition TEXT,
  physical_sim INTEGER,
  attrs TEXT NOT NULL DEFAULT '{}',
  pluses TEXT NOT NULL DEFAULT '[]',
  nuances TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0,
  parse_ok INTEGER NOT NULL DEFAULT 0,
  parsed_by TEXT NOT NULL DEFAULT 'rules',
  confirmed INTEGER NOT NULL DEFAULT 0,
  post_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sold_at INTEGER,
  UNIQUE (store_id, msg_id)
);
CREATE INDEX idx_listings_store_status ON listings (store_id, status);
CREATE INDEX idx_listings_model ON listings (store_id, model_id);
CREATE INDEX idx_listings_price ON listings (store_id, price);
CREATE INDEX idx_listings_group ON listings (store_id, media_group_id);

-- listing_id пустой, пока не пришла подпись альбома
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER REFERENCES listings (id) ON DELETE CASCADE,
  store_id TEXT NOT NULL,
  media_group_id TEXT,
  msg_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  storage_key TEXT,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, msg_id, kind)
);
CREATE INDEX idx_media_listing ON media (listing_id);
CREATE INDEX idx_media_group ON media (store_id, media_group_id);

CREATE TABLE price_history (
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX idx_price_listing ON price_history (listing_id);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  tg_user_id INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  title TEXT NOT NULL,
  storage_gb INTEGER,
  max_price INTEGER,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_subs_model ON subscriptions (store_id, model_id, active);
CREATE INDEX idx_subs_user ON subscriptions (store_id, tg_user_id);

-- одно уведомление на пользователя на карточку
CREATE TABLE notifications (
  listing_id INTEGER NOT NULL,
  tg_user_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (listing_id, tg_user_id)
);

-- Заявки «Купить»: статусы и «кто ещё интересовался» появятся на этапе 5
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  listing_id INTEGER NOT NULL,
  tg_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_leads_store ON leads (store_id, created_at);
CREATE INDEX idx_leads_listing ON leads (listing_id);

-- meta — JSON с фильтрами поиска: из них считается «спрос без товара»
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  tg_user_id INTEGER,
  type TEXT NOT NULL,
  listing_id INTEGER,
  model_id TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_store_time ON events (store_id, type, created_at);

CREATE TABLE users (
  tg_user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  updated_at INTEGER NOT NULL
);

-- Ответы Gemini по хэшу текста поста: правка без изменений не тратит запрос
CREATE TABLE llm_cache (
  hash TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
