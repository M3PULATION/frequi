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

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isReadOnly(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' && READONLY_POST.has(path)) return true;
  return false;
}

export function freqtradeBotsPlugin(configPath: string): Plugin {
  const bots = loadBotConfigs(readFileSync(configPath, 'utf8'));
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const sessions = new Map<string, Session>();
  let catalog: { at: number; bots: ListedBot[] } | null = null;

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

  async function sessionFor(bot: BotConfig): Promise<Session> {
    return sessions.get(bot.id) ?? login(bot);
  }

  async function describe(bot: BotConfig): Promise<ListedBot> {
    try {
      const session = await sessionFor(bot);
      const response = await fetch(`${bot.origin}/api/v1/show_config`, {
        headers: { Authorization: `Bearer ${session.access}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const config = (await response.json()) as { strategy?: string; bot_name?: string };
      const strategy = config.strategy || '';
      const botName = config.bot_name || '';
      return {
        id: bot.id,
        name: bot.name,
        strategy,
        botName,
        host: bot.host,
        online: true,
      };
    } catch {
      sessions.delete(bot.id);
      return { id: bot.id, name: bot.name, strategy: '', botName: '', host: bot.host, online: false };
    }
  }

  async function listBots(): Promise<ListedBot[]> {
    if (catalog && Date.now() - catalog.at < 10_000) return catalog.bots;
    const listed = await Promise.all(bots.map((bot) => describe(bot)));
    catalog = { at: Date.now(), bots: listed };
    return listed;
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

    let session = await sessionFor(bot);
    let upstream = await send(session);
    if (upstream.status === 401) {
      session = await refresh(bot, session);
      upstream = await send(session);
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.end(payload);
  }

  return {
    name: 'freqtrade-bots',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url.startsWith('/local/bots')) {
          void listBots()
            .then((listed) => {
              res.setHeader('Content-Type', 'application/json');
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
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: error instanceof Error ? error.message : '实盘不可达' }));
        });
      });
    },
  };
}
