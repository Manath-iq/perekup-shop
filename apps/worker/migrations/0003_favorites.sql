-- Избранное покупателя: price — цена на момент добавления, чтобы сообщить о снижении
CREATE TABLE favorites (
  store_id TEXT NOT NULL,
  tg_user_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  price INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, tg_user_id, listing_id)
);
CREATE INDEX idx_fav_listing ON favorites (listing_id);
