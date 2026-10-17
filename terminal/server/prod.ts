import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBotProxy } from './botsProxy.ts';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const botsFile = process.env.BOTS_FILE || fileURLToPath(new URL('../bots.local.json', import.meta.url));
const port = Number(process.env.PORT || 80);
const proxy = createBotProxy(botsFile);

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
  let file = resolve(dist, requested.replace(/^[/\\]/, ''));
  const root = resolve(dist);
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  proxy(req, res, () => serveStatic(req, res));
}).listen(port, '0.0.0.0', () => {
  console.log(`实盘操作台 http://0.0.0.0:${port}`);
});
