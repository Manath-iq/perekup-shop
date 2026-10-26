import type { CabinetData, Facets, Listing, Subscription } from '@vitrina/core/types';
import { initData, storeId } from './tg';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-init-data': initData, ...(storeId ? { 'x-store': storeId } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export interface StoreInfo {
  id: string;
  name: string;
  channel: string;
  seller: string;
  avatar: string | null;
  theme: { preset?: string; accent?: string } | null;
  bot_username: string;
  default_brand: string | null;
  about: { city: string; delivery: string; warranty: string; payment: string; demo: boolean };
  reviews: { url: string; title: string; subscribers: string | null; photos: string[] } | null;
}

export interface NewSubscription {
  model_id: string;
  title: string;
  storage_gb: number | null;
  max_price: number | null;
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  listings: () => req<{ items: Listing[] }>('/api/listings').then((r) => r.items),
  listing: (id: number) => req<Listing>(`/api/listings/${id}`),
  facets: () => req<Facets>('/api/facets'),
  store: () => req<StoreInfo>('/api/store'),
  me: () => req<{ id: number; is_admin: boolean }>('/api/me'),
  event: (type: 'app_open' | 'card_view' | 'search', extra: { listing_id?: number; model_id?: string; meta?: unknown } = {}) =>
    initData ? req('/api/events', post({ type, ...extra })).catch(() => {}) : Promise.resolve(),
  contact: (listing_id: number, kind: 'buy' | 'ask') => req<{ ok: boolean; text: string; url: string }>('/api/buy', post({ listing_id, kind })),
  subscriptions: () => req<{ items: Subscription[] }>('/api/subscriptions').then((r) => r.items),
  subscribe: (s: NewSubscription) => req<{ items: Subscription[] }>('/api/subscriptions', post(s)).then((r) => r.items),
  unsubscribe: (id: number) => req<{ items: Subscription[] }>(`/api/subscriptions/${id}`, { method: 'DELETE' }).then((r) => r.items),
  favorites: () => req<{ items: Listing[] }>('/api/favorites').then((r) => r.items),
  favorite: (id: number, on: boolean) => req(`/api/favorites/${id}`, { method: on ? 'PUT' : 'DELETE' }),
  cabinet: (days: number) => req<CabinetData>(`/api/cabinet?days=${days}`),
  listingAction: (id: number, action: 'confirm' | 'hide' | 'sold' | 'reserve' | 'active') => req(`/api/cabinet/listings/${id}`, post({ action })),
  leadStatus: (id: number, status: 'new' | 'work' | 'sold') => req(`/api/cabinet/leads/${id}`, post({ status })),
};
