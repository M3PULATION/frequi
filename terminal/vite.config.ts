import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Local Workers runtime started by `pnpm dev:worker`.
 *
 * Keep the admin entry in `proxy` in sync with ADMIN_BASE in worker/core.ts.
 * It is hardcoded here because Vite resolves this file outside the worker
 * module graph, and importing core.ts would pull the admin HTML into the
 * Vite config.
 */
const WORKER_ORIGIN = 'http://127.0.0.1:8787';

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
      '/my-private-entry': WORKER_ORIGIN,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
