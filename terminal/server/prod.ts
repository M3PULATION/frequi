import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { normalize, resolve, sep } from 'path';
import { readFile } from 'fs';
import { promisify } from 'util';
import { createProxy } from './botsProxy';

const readFileAsync = promisify(readFile);

const mime: Record<string, string> = {
  html: 'text/html',
  js: 'application/javascript',
  css: 'text/css',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    // Malformed percent-encoding (e.g. "/%") must not throw out of the request handler.
    res.statusCode = 400;
    res.end();
    return;
  }
  const requested = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  let file = resolve(dist, requested.replace(/^[/\\]/, ''));
  const root = resolve(dist);
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  ...
}
