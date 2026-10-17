import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { freqtradeBotsPlugin } from './server/botsProxy';

const botsFile = fileURLToPath(new URL('./bots.local.json', import.meta.url));

export default defineConfig(() => {
  readFileSync(botsFile, 'utf8');
  return {
    plugins: [react(), tailwindcss(), freqtradeBotsPlugin(botsFile)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3001,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
