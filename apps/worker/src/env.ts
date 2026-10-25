export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  BOT_TOKEN: string;
  BOT_USERNAME: string;
  /** Telegram ID админов через запятую */
  ADMIN_IDS: string;
  WEBHOOK_SECRET: string;
  ADMIN_API_KEY: string;
  PUBLIC_READ?: string;
}

export const adminIds = (env: Env): number[] =>
  (env.ADMIN_IDS ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter(Number.isFinite);

export const now = () => Math.floor(Date.now() / 1000);
