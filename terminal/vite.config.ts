import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { freqtradeBotsPlugin } from './server/botsProxy';

const botsFile = fileURLToPath(new URL('./bots.local.json', import.meta.url));

export default defineConfig(({ command }) => {
  const plugins = [react(), tailwindcss()];
  if (command === 'serve') {
    readFileSync(botsFile, 'utf8');
    plugins.push(freqtradeBotsPlugin(botsFile));
  }
  return {
    plugins,
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
