-- Пост-прайс даёт несколько карточек: item — номер строки (0 — обычный пост с одним товаром).
-- В SQLite уникальность не меняется ALTER-ом, поэтому таблица пересоздаётся.
PRAGMA defer_foreign_keys = true;

CREATE TABLE listings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  item INTEGER NOT NULL DEFAULT 0,
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
  UNIQUE (store_id, msg_id, item)
);

INSERT INTO listings_new (id, store_id, msg_id, item, media_group_id, category, brand, model_id, line, short, title, price, storage_gb,
  battery_pct, condition, physical_sim, attrs, pluses, nuances, status, confidence, parse_ok, parsed_by, confirmed, post_url,
  created_at, updated_at, sold_at)
SELECT id, store_id, msg_id, 0, media_group_id, category, brand, model_id, line, short, title, price, storage_gb,
  battery_pct, condition, physical_sim, attrs, pluses, nuances, status, confidence, parse_ok, parsed_by, confirmed, post_url,
  created_at, updated_at, sold_at
FROM listings;

DROP TABLE listings;
ALTER TABLE listings_new RENAME TO listings;

CREATE INDEX idx_listings_store_status ON listings (store_id, status);
CREATE INDEX idx_listings_model ON listings (store_id, model_id);
CREATE INDEX idx_listings_price ON listings (store_id, price);
CREATE INDEX idx_listings_group ON listings (store_id, media_group_id);
CREATE INDEX idx_listings_msg ON listings (store_id, msg_id);

PRAGMA defer_foreign_keys = false;
