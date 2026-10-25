export {};
/**
 * Импорт актуальных постов с публичной ленты канала в задеплоенный каталог.
 *   RAXI_URL=https://raxi-catalog.<subdomain>.workers.dev RAXI_ADMIN_KEY=... node scripts/import.ts [pages]
 * Сам разбор ленты и загрузка фото выполняются в воркере (/admin/import), скрипт докачивает медиа порциями.
 */
const base = process.env.RAXI_URL;
const key = process.env.RAXI_ADMIN_KEY;
if (!base || !key) {
  console.error('Нужны переменные RAXI_URL и RAXI_ADMIN_KEY');
  process.exit(1);
}
const pages = process.argv[2] ?? '3';

const call = async (path: string) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-admin-key': key } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
};

const result = await call(`/admin/import?pages=${pages}`);
console.log('импорт:', result);
let media = result.media as { remaining: number };
while (media.remaining > 0) {
  media = (await call('/admin/media')) as { remaining: number };
  console.log('медиа:', media);
}
console.log('отзывы:', await call('/admin/reviews'));
