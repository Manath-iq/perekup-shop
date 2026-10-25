CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_channel TEXT NOT NULL,
  channel_msg_id INTEGER NOT NULL,
  media_group_id TEXT,
  category TEXT NOT NULL DEFAULT 'iphone',
  model_raw TEXT,
  family TEXT,
  storage_gb INTEGER,
  condition TEXT,
  sim TEXT,
  has_physical_sim INTEGER,
  battery_pct INTEGER,
  battery_cycles INTEGER,
  ios TEXT,
  pluses TEXT NOT NULL DEFAULT '[]',
  nuances TEXT NOT NULL DEFAULT '[]',
  kit TEXT,
  full_kit INTEGER NOT NULL DEFAULT 0,
  price_rub INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  parse_ok INTEGER NOT NULL DEFAULT 1,
  confirmed INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT NOT NULL,
  post_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sold_at INTEGER,
  UNIQUE (source_channel, channel_msg_id)
);
CREATE INDEX idx_listings_status ON listings (status);
CREATE INDEX idx_listings_family ON listings (family);
CREATE INDEX idx_listings_price ON listings (price_rub);
CREATE INDEX idx_listings_group ON listings (media_group_id);

-- listing_id пустой, пока не пришла подпись альбома
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER REFERENCES listings (id) ON DELETE CASCADE,
  source_channel TEXT NOT NULL,
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
  UNIQUE (source_channel, msg_id, kind)
);
CREATE INDEX idx_media_listing ON media (listing_id);
CREATE INDEX idx_media_group ON media (media_group_id);

CREATE TABLE price_history (
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  price_rub INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX idx_price_listing ON price_history (listing_id);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id INTEGER NOT NULL,
  family TEXT NOT NULL,
  storage_gb INTEGER,
  max_price INTEGER,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_subs_family ON subscriptions (family, active);
CREATE INDEX idx_subs_user ON subscriptions (tg_user_id);

-- одно уведомление на пользователя на пост
CREATE TABLE notifications (
  listing_id INTEGER NOT NULL,
  tg_user_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (listing_id, tg_user_id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id INTEGER,
  type TEXT NOT NULL,
  listing_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_type_time ON events (type, created_at);

CREATE TABLE users (
  tg_user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  updated_at INTEGER NOT NULL
);
