import type { Facets, Listing, Subscription } from '@vitrina/core/types';
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
  name: string;
  channel: string;
  seller: string;
  about: { city: string; delivery: string; warranty: string; payment: string; demo: boolean };
  reviews: { url: string; title: string; subscribers: string | null; photos: string[] } | null;
}

export const api = {
  listings: () => req<{ items: Listing[] }>('/api/listings').then((r) => r.items),
  listing: (id: number) => req<Listing>(`/api/listings/${id}`),
  facets: () => req<Facets>('/api/facets'),
  store: () => req<StoreInfo>('/api/store'),
  event: (type: 'app_open' | 'card_view' | 'subscribe', listing_id?: number) =>
    initData ? req('/api/events', { method: 'POST', body: JSON.stringify({ type, listing_id }) }).catch(() => {}) : Promise.resolve(),
  buy: (listing_id: number) =>
    req<{ ok: boolean; text: string; url: string }>('/api/buy', { method: 'POST', body: JSON.stringify({ listing_id }) }),
  subscriptions: () => req<{ items: Subscription[] }>('/api/subscriptions').then((r) => r.items),
  subscribe: (s: { family: string; storage_gb: number | null; max_price: number | null }) =>
    req<{ items: Subscription[] }>('/api/subscriptions', { method: 'POST', body: JSON.stringify(s) }).then((r) => r.items),
  unsubscribe: (id: number) => req<{ items: Subscription[] }>(`/api/subscriptions/${id}`, { method: 'DELETE' }).then((r) => r.items),
};
