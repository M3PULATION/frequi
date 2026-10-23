import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Local Workers runtime started by `pnpm dev:worker`.
 *
 * Keep the admin entry in `proxy` in sync with the ADMIN_PATH var. Vite reads
 * the config outside the worker module graph, so this cannot come from
 * wrangler.jsonc; set ADMIN_PATH in the environment for Vite as well when you
 * customize the path (`ADMIN_PATH=/my-entry pnpm dev`).
 */
const WORKER_ORIGIN = 'http://127.0.0.1:8787';
const ADMIN_PATH = process.env.ADMIN_PATH?.trim() || '/admin';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3001,
    proxy: {
      '/api': WORKER_ORIGIN,
      '/local': WORKER_ORIGIN,
      '/healthz': WORKER_ORIGIN,
      '/openapi.json': WORKER_ORIGIN,
      [ADMIN_PATH]: WORKER_ORIGIN,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
