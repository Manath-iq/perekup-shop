import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// API в разработке — локальный `npm run dev:worker` (wrangler dev, порт 8787)
const api = process.env.VITRINA_API ?? 'http://localhost:8787';

export default defineConfig({
  root: 'apps/miniapp',
  plugins: [preact()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  server: { proxy: { '/api': api, '/media': api } },
});
