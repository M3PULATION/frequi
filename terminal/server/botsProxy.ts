import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type BotConfig = {
  id: string;
  name: string;
  origin: string;
  host: string;
  username: string;
  password: string;
};

export type ListedBot = {
  id: string;
  name: string;
  strategy: string;
  botName: string;
  host: string;
  online: boolean;
};

type Session = {
  access: string;
  refresh: string;
};

const READONLY_POST = new Set(['/api/v1/pair_candles', '/api/v1/pair_history']);
/** Refresh the access token this long before it expires, so a probe does not trip on 401. */
export const ACCESS_TOKEN_SKEW_MS = 60_000;
/** Successful catalog stays warm. A miss is retried sooner so a bot can come back. */
export const CATALOG_SUCCESS_MS = 60_000;
export const CATALOG_FAILURE_MS = 15_000;
/** A failed probe keeps the last good reading, instead of clearing the strategy immediately. */
export const CATALOG_GRACE_MS = 3 * 60_000;

export function jwtExpiryMs(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const body = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof body.exp === 'number' ? body.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function accessTokenUsable(token: string, now = Date.now(), skewMs = ACCESS_TOKEN_SKEW_MS): boolean {
  const exp = jwtExpiryMs(token);
  if (exp == null) return false;
  return exp - now > skewMs;
}

export function catalogTtl(listed: ListedBot[]): number {
  return listed.length > 0 && listed.every((bot) => bot.online) ? CATALOG_SUCCESS_MS : CATALOG_FAILURE_MS;
}

/** Keep the previous strategy through a blip. After the grace window the bot is offline, but the name stays. */
export function describeFallback(previous: { at: number; listed: ListedBot }, now: number): ListedBot {
  if (now - previous.at < CATALOG_GRACE_MS) return previous.listed;
  return { ...previous.listed, online: false };
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

export function normalizeBotUrl(input: string): string {
  let value = input.trim().replace(/\/+$/, '');
  value = value.replace(/\/dashboard$/, '');
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

export function botIdFromOrigin(origin: string): string {
  return new URL(origin).host.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

export function loadBotConfigs(raw: string): BotConfig[] {
  const parsed = JSON.parse(raw) as Array<{ name?: string; url?: string; username?: string; password?: string }>;
  if (!Array.isArray(parsed)) throw new Error('bots.local.json 必须是数组');
  return parsed.map((item) => {
    if (!item.name?.trim() || !item.url || !item.username || !item.password) {
      throw new Error('每台实盘都需要 name、url、username、password');
    }
    const origin = normalizeBotUrl(item.url);
    return {
      id: botIdFromOrigin(origin),
      name: item.name.trim(),
      origin,
      host: new URL(origin).host,
      username: item.username,
      password: item.password,
    };
  });
}

/** The only POST bodies we forward are small candle/history queries. */
export const MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        reject(new BodyTooLargeError('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isReadOnly(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' && READONLY_POST.has(path)) return true;
  return false;
}

export function createBotProxy(configPath: string) {
  const bots = loadBotConfigs(readFileSync(configPath, 'utf8'));
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const sessions = new Map<string, Session>();
  const renewing = new Map<string, Promise<Session>>();
  const remembered = new Map<string, { at: number; listed: ListedBot }>();
  let catalog: { at: number; ttl: number; bots: ListedBot[] } | null = null;
  let catalogFlight: Promise<ListedBot[]> | null = null;

  async function login(bot: BotConfig): Promise<Session> {
    const response = await fetch(`${bot.origin}/api/v1/token/login`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(bot.username, bot.password),
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`登录失败 ${response.status}`);
    const data = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token || !data.refresh_token) throw new Error('登录响应缺少 token');
    const session = { access: data.access_token, refresh: data.refresh_token };
    sessions.set(bot.id, session);
    return session;
  }

  async function refresh(bot: BotConfig, session: Session): Promise<Session> {
    const response = await fetch(`${bot.origin}/api/v1/token/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.refresh}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return login(bot);
    const data = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token) return login(bot);
    const next = { access: data.access_token, refresh: data.refresh_token || session.refresh };
    sessions.set(bot.id, next);
    return next;
  }

  function ensureSession(bot: BotConfig, force = false): Promise<Session> {
    if (force) {
      const current = sessions.get(bot.id);
      if (current) sessions.set(bot.id, { ...current, access: '' });
    }
    const cached = sessions.get(bot.id);
    if (!force && cached && accessTokenUsable(cached.access)) return Promise.resolve(cached);
    const existing = renewing.get(bot.id);
    if (existing) return existing;
    const task = (async () => {
      const current = sessions.get(bot.id);
      if (current?.refresh) {
        try {
          return await refresh(bot, current);
        } catch {
          sessions.delete(bot.id);
        }
      }
      return login(bot);
    })().finally(() => {
      if (renewing.get(bot.id) === task) renewing.delete(bot.id);
    });
    renewing.set(bot.id, task);
    return task;
  }

  async function readConfig(bot: BotConfig): Promise<ListedBot> {
    const load = (session: Session) =>
      fetch(`${bot.origin}/api/v1/show_config`, {
        headers: { Authorization: `Bearer ${session.access}` },
        signal: AbortSignal.timeout(12_000),
      });
    let session = await ensureSession(bot);
    let response = await load(session);
    if (response.status === 401) {
      session = await ensureSession(bot, true);
      response = await load(session);
    }
    if (!response.ok) throw new Error(String(response.status));
    const config = (await response.json()) as { strategy?: string; bot_name?: string };
    return {
      id: bot.id,
      name: bot.name,
      strategy: config.strategy || '',
      botName: config.bot_name || '',
      host: bot.host,
      online: true,
    };
  }

  async function describe(bot: BotConfig): Promise<{ listed: ListedBot; live: boolean }> {
    try {
      const listed = await readConfig(bot);
      remembered.set(bot.id, { at: Date.now(), listed });
      return { listed, live: true };
    } catch {
      const previous = remembered.get(bot.id);
      if (previous) return { listed: describeFallback(previous, Date.now()), live: false };
      return {
        listed: { id: bot.id, name: bot.name, strategy: '', botName: '', host: bot.host, online: false },
        live: false,
      };
    }
  }

  function listBots(): Promise<ListedBot[]> {
    const now = Date.now();
    if (catalog && now - catalog.at < catalog.ttl) return Promise.resolve(catalog.bots);
    if (catalogFlight) return catalogFlight;
    catalogFlight = Promise.all(bots.map((bot) => describe(bot)))
      .then((probed) => {
        const listed = probed.map((item) => item.listed);
        const carried = probed.some((item) => !item.live);
        catalog = { at: Date.now(), ttl: carried ? CATALOG_FAILURE_MS : catalogTtl(listed), bots: listed };
        return listed;
      })
      .finally(() => {
        catalogFlight = null;
      });
    return catalogFlight;
  }

  async function forward(req: IncomingMessage, res: ServerResponse, bot: BotConfig) {
    const method = (req.method || 'GET').toUpperCase();
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (!isReadOnly(method, requestUrl.pathname)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ detail: '这个面板只读' }));
      return;
    }
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    const target = `${bot.origin}${requestUrl.pathname}${requestUrl.search}`;

    const send = async (session: Session) =>
      fetch(target, {
        method,
        headers: {
          Authorization: `Bearer ${session.access}`,
          ...(body && body.length > 0 ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(25_000),
      });

    let session = await ensureSession(bot);
    let upstream = await send(session);
    if (upstream.status === 401) {
      session = await ensureSession(bot, true);
      upstream = await send(session);
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.end(payload);
  }

  return function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url || '';
    if (url.startsWith('/local/bots')) {
      void listBots()
        .then((listed) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(listed));
        })
        .catch((error: unknown) => {
          res.statusCode = 500;
          res.end(error instanceof Error ? error.message : '无法读取实盘列表');
        });
      return;
    }
    if (!url.startsWith('/api/')) {
      next();
      return;
    }
    const header = req.headers['x-ft-bot'];
    const id = Array.isArray(header) ? header[0] : header;
    const bot = id ? byId.get(id) : undefined;
    if (!bot) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ detail: '未知实盘' }));
      return;
    }
    void forward(req, res, bot).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof BodyTooLargeError) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Connection', 'close');
        // Answer first, then drop the connection so the unread body is not buffered.
        res.end(JSON.stringify({ detail: error.message }), () => req.destroy());
        return;
      }
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ detail: error instanceof Error ? error.message : '实盘不可达' }));
    });
  };
}

export function freqtradeBotsPlugin(configPath: string): Plugin {
  const handle = createBotProxy(configPath);
  return {
    name: 'freqtrade-bots',
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, () => next()));
    },
  };
}
