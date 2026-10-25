import { resolveProfile, type ParseProfile } from '@vitrina/core/profile';
import type { StoreConfig } from '@vitrina/core/store';
import type { Env } from './env';
import { now } from './env';

export interface Store {
  id: string;
  channel: string;
  kind: 'client' | 'demo';
  config: StoreConfig;
  profile: ParseProfile;
  expires_at: number | null;
}

/** Всё, что нужно обработчикам: окружение и магазин, с которым работаем */
export interface Ctx {
  env: Env;
  store: Store;
}

interface StoreRow {
  id: string;
  channel: string;
  kind: 'client' | 'demo';
  config: string;
  profile: string;
  expires_at: number | null;
}

const toStore = (r: StoreRow): Store => ({
  id: r.id,
  channel: r.channel,
  kind: r.kind,
  config: JSON.parse(r.config),
  profile: resolveProfile(JSON.parse(r.profile)),
  expires_at: r.expires_at,
});

// Кэш на время жизни изолята: настройки меняются редко, а читаются на каждом запросе
const cache = new Map<string, { store: Store; at: number }>();
const TTL = 60_000;

export async function getStore(env: Env, id: string): Promise<Store | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.store;
  const row = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first<StoreRow>();
  if (!row) return null;
  const store = toStore(row);
  if (store.expires_at && store.expires_at < now()) return null;
  cache.set(id, { store, at: Date.now() });
  return store;
}

/** Магазин по каналу: username публичного канала или id приватного */
export async function getStoreByChannel(env: Env, channel: string): Promise<Store | null> {
  if (env.STORE_ID) {
    const s = await getStore(env, env.STORE_ID);
    return s && s.channel.toLowerCase() === channel.toLowerCase() ? s : null;
  }
  const row = await env.DB.prepare('SELECT * FROM stores WHERE channel = ? COLLATE NOCASE').bind(channel).first<StoreRow>();
  return row ? toStore(row) : null;
}

/** Магазин для запроса мини-аппа: у клиентского деплоя он один, у демо — из параметра запуска */
export async function resolveStore(env: Env, requested: string | null | undefined): Promise<Store | null> {
  return getStore(env, env.STORE_ID || requested || '');
}

export async function listStores(env: Env): Promise<Store[]> {
  if (env.STORE_ID) {
    const s = await getStore(env, env.STORE_ID);
    return s ? [s] : [];
  }
  const { results } = await env.DB.prepare('SELECT * FROM stores WHERE expires_at IS NULL OR expires_at > ?').bind(now()).all<StoreRow>();
  return results.map(toStore);
}

export async function saveStore(
  env: Env,
  s: { config: StoreConfig; profile: Partial<ParseProfile>; kind?: 'client' | 'demo'; expires_at?: number | null },
) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO stores (id, channel, config, profile, kind, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET channel = excluded.channel, config = excluded.config, profile = excluded.profile,
       kind = excluded.kind, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
  )
    .bind(s.config.slug, s.config.channel, JSON.stringify(s.config), JSON.stringify(resolveProfile(s.profile)), s.kind ?? 'client', ts, ts, s.expires_at ?? null)
    .run();
  cache.delete(s.config.slug);
}
