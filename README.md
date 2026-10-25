# Витрина

Telegram-магазин для перекупщиков техники. Продавец постит в канал как раньше, бот сам ведёт каталог: покупатель видит только то, что в наличии, и пишет продавцу в один тап. Продавец видит заявки и спрос.

Видение, архитектура и план работ — в [docs/PRODUCT.md](docs/PRODUCT.md).

## Структура

| Папка | Что внутри |
| --- | --- |
| `packages/core` | Разбор постов, разбор ленты `t.me/s`, типы. Без зависимостей, работает в Workers и Node |
| `apps/worker` | Cloudflare Worker: бот (grammY), API (Hono), cron, раздача мини-аппа и медиа |
| `apps/miniapp` | Мини-апп на Preact + Vite |
| `clients/<slug>` | Конфиг клиента и профиль разбора (появится на этапе 1) |
| `scripts` | Импорт ленты, выгрузка анимированных эмодзи |

Основа взята из прототипа RaXi Store (`~/myAI/iphone_market`).

## Команды

```bash
npm install
npm run check       # typecheck + тесты + сборка мини-аппа
npm run dev:worker  # wrangler dev на :8787, секреты в apps/worker/.dev.vars
npm run dev:app     # мини-апп на vite, /api проксируется на :8787
```

Секреты не коммитятся: локально `.env` (CLI) и `apps/worker/.dev.vars` (wrangler dev), в бою — `wrangler secret put`. Образец — `.env.example`.
