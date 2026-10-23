/**
 * Cloudflare Workers entry for the read-only Freqtrade terminal.
 *
 * Mirrors the behaviour of server/botsProxy.ts using Web APIs only, so the
 * same frontend can be served either by the Node container or by Workers.
 */

import { adminPageHtml } from './adminPage';

export type BotConfig = {
  id: string;
  name: string;
  origin: string;
  host: string;
  username: string;
  password: string;
};

/** The subset of KVNamespace this worker needs. Keeps the tests free of Workers types. */
export type BotKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type BotSource = 'kv' | 'secret' | 'none';

/** Shape returned to the browser: credentials are never included. */
export type AdminBot = {
  name: string;
  url: string;
  username: string;
  password: null;
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

export type WorkerEnv = {
  /** JSON array in the same shape as bots.example.json. */
  BOTS_CONFIG?: string;
  /** KV namespace holding the editable config under the `bots` key. */
  BOTS_KV?: BotKV;
  /** Bearer token for the admin API. */
  ADMIN_TOKEN?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

const READONLY_POST = new Set(['/api/v1/pair_candles', '/api/v1/pair_history']);
/**
 * Private path that serves the config page and prefixes its API. It is not
 * advertised anywhere: the page must not be linked from the public terminal.
 */
export const ADMIN_BASE = '/my-private-entry';
/** Refresh the access token this long before it expires, so a probe does not trip on 401. */
export const ACCESS_TOKEN_SKEW_MS = 60_000;
/** Successful catalog stays warm. A miss is retried sooner so a bot can come back. */
export const CATALOG_SUCCESS_MS = 60_000;
export const CATALOG_FAILURE_MS = 15_000;
/** A failed probe keeps the last good reading, instead of clearing the strategy immediately. */
export const CATALOG_GRACE_MS = 3 * 60_000;
/** POST bodies are limited to freqtrade candle queries; anything larger is rejected. */
export const MAX_BODY_BYTES = 64 * 1024;
/** KV reads are cached for this long so /api/* does not pay for a read per request. */
export const CONFIG_CACHE_MS = 5_000;
export const ADMIN_MAX_FAILURES = 10;
export const ADMIN_FAILURE_WINDOW_MS = 5 * 60_000;
export const BOTS_KV_KEY = 'bots';

class BadRequestError extends Error {}

function decodeBase64Url(part: string): string {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function jwtExpiryMs(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const body = JSON.parse(decodeBase64Url(part)) as { exp?: unknown };
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${toBase64(new TextEncoder().encode(`${username}:${password}`))}`;
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
  if (!Array.isArray(parsed)) throw new Error('BOTS_CONFIG 必须是数组');
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

/** Strip credentials before a config ever reaches a response body. */
export function sanitizeBots(bots: BotConfig[]): AdminBot[] {
  return bots.map((bot) => ({
    name: bot.name,
    url: bot.origin,
    username: bot.username,
    password: null,
  }));
}

/**
 * Merge the editor payload with the current config. The browser never receives
 * passwords, so a blank field means "keep the existing password".
 *
 * Passwords are matched by identity (normalized origin + username), never by
 * array index: reordering rows or repointing a row at another host must not
 * hand one bot's password to a different bot. Repointing a row therefore
 * requires the password to be typed again.
 */
export function resolveAdminBots(input: unknown, previous: BotConfig[]): BotConfig[] {
  if (!Array.isArray(input)) throw new BadRequestError('bots 必须是数组');

  const merged = input.map((item, index) => {
    const position = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestError(`第 ${position} 台实盘格式无效`);
    }
    const bot = item as Record<string, unknown>;
    if (typeof bot.name !== 'string' || !bot.name.trim()) {
      throw new BadRequestError(`第 ${position} 台实盘缺少 name`);
    }
    if (typeof bot.url !== 'string' || !bot.url.trim()) {
      throw new BadRequestError(`第 ${position} 台实盘缺少 url`);
    }
    if (typeof bot.username !== 'string' || !bot.username) {
      throw new BadRequestError(`第 ${position} 台实盘缺少 username`);
    }

    if (bot.password != null && bot.password !== '' && typeof bot.password !== 'string') {
      throw new BadRequestError(`第 ${position} 台实盘的 password 格式无效`);
    }

    const candidate = { name: bot.name, url: bot.url, username: bot.username, password: bot.password as string | null | undefined };

    let normalized: BotConfig;
    try {
      // Reuse the runtime validation, including URL normalization.
      normalized = loadBotConfigs(
        JSON.stringify([{ ...candidate, password: typeof bot.password === 'string' && bot.password ? bot.password : 'placeholder' }]),
      )[0]!;
    } catch {
      // Never echo JSON.parse / URL errors: they may quote the raw entry.
      throw new BadRequestError(`第 ${position} 台实盘配置无效`);
    }

    const typed = typeof bot.password === 'string' && bot.password.length > 0 ? bot.password : null;
    if (typed != null) {
      return { ...normalized, password: typed };
    }

    // Blank password: only inherit when this row still points at the same bot.
    const source = previous.find(
      (existing) => existing.origin === normalized.origin && existing.username === normalized.username,
    );
    if (!source) {
      throw new BadRequestError(
        `第 ${position} 台实盘需要重新填写 password（主机或用户名已变更）`,
      );
    }
    return { ...normalized, password: source.password };
  });

  return merged;
}

/** Compare secrets without short-circuiting on the first mismatch. */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function isReadOnly(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' && READONLY_POST.has(path)) return true;
  return false;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

type KvCacheEntry = { at: number; raw: string | null };
/** Per-isolate KV cache. WeakMap keys keep tests (and dev hot reloads) isolated. */
const kvCache = new WeakMap<BotKV, KvCacheEntry>();

async function kvRaw(env: WorkerEnv, now: number): Promise<string | null> {
  const kv = env.BOTS_KV;
  if (!kv) return null;
  const cached = kvCache.get(kv);
  if (cached && now - cached.at < CONFIG_CACHE_MS) return cached.raw;

  let raw: string | null = null;
  try {
    const value = await kv.get(BOTS_KV_KEY);
    if (typeof value === 'string' && value.trim()) raw = value;
  } catch {
    // A KV outage should not take the terminal down; fall back to the secret.
    raw = null;
  }
  kvCache.set(kv, { at: now, raw });
  return raw;
}

async function resolveConfig(env: WorkerEnv, now = Date.now()): Promise<{ raw: string | null; source: BotSource }> {
  const fromKv = await kvRaw(env, now);
  if (fromKv) return { raw: fromKv, source: 'kv' };
  const secret = env.BOTS_CONFIG;
  if (typeof secret === 'string' && secret.trim()) return { raw: secret, source: 'secret' };
  return { raw: null, source: 'none' };
}

type FailureEntry = { count: number; resetAt: number };
const adminFailures = new Map<string, FailureEntry>();

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function recordFailure(ip: string, now: number): void {
  const current = adminFailures.get(ip);
  if (!current || now >= current.resetAt) {
    adminFailures.set(ip, { count: 1, resetAt: now + ADMIN_FAILURE_WINDOW_MS });
  } else {
    current.count += 1;
  }
  if (adminFailures.size > 256) {
    for (const [key, value] of adminFailures) {
      if (now >= value.resetAt) adminFailures.delete(key);
    }
  }
}

/** Returns null when the request may proceed, otherwise the rejection response. */
function adminDenied(request: Request, env: WorkerEnv, now = Date.now()): Response | null {
  const expected = env.ADMIN_TOKEN;
  if (typeof expected !== 'string' || expected.length === 0) {
    return json(
      { detail: '未配置管理令牌', hint: '请运行 npx wrangler secret put ADMIN_TOKEN 设置令牌' },
      503,
      NO_STORE,
    );
  }

  const ip = clientIp(request);
  const failure = adminFailures.get(ip);
  if (failure && now < failure.resetAt && failure.count >= ADMIN_MAX_FAILURES) {
    return json({ detail: '尝试次数过多，请稍后再试' }, 429, NO_STORE);
  }

  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const supplied = match ? match[1]! : '';
  if (constantTimeEqual(supplied, expected)) {
    adminFailures.delete(ip);
    return null;
  }

  recordFailure(ip, now);
  return json({ detail: '令牌无效' }, 401, NO_STORE);
}

async function getAdminConfig(env: WorkerEnv): Promise<Response> {
  const { raw, source } = await resolveConfig(env);
  if (!raw) return json({ bots: [], source: 'none' }, 200, NO_STORE);

  let bots: BotConfig[];
  try {
    bots = loadBotConfigs(raw);
  } catch {
    return json({ detail: '当前配置格式无效' }, 500, NO_STORE);
  }
  return json({ bots: sanitizeBots(bots), source }, 200, NO_STORE);
}

async function putAdminConfig(request: Request, env: WorkerEnv): Promise<Response> {
  const kv = env.BOTS_KV;
  if (!kv) {
    return json(
      { detail: '未配置 KV 存储', hint: '请在 wrangler.jsonc 中绑定 BOTS_KV' },
      503,
      NO_STORE,
    );
  }

  const read = await readLimitedBody(request);
  if (!read.ok) return json({ detail: '请求体过大' }, 413, NO_STORE);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(read.body ?? new Uint8Array()));
  } catch {
    return json({ detail: '请求体不是有效的 JSON' }, 400, NO_STORE);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ detail: '请求体格式无效' }, 400, NO_STORE);
  }

  const { raw } = await resolveConfig(env);
  let previous: BotConfig[] = [];
  if (raw) {
    try {
      previous = loadBotConfigs(raw);
    } catch {
      previous = [];
    }
  }

  let bots: BotConfig[];
  try {
    bots = resolveAdminBots((payload as { bots?: unknown }).bots, previous);
  } catch (error) {
    const detail = error instanceof BadRequestError ? error.message : '配置无效';
    return json({ detail }, 400, NO_STORE);
  }

  const stored = bots.map((bot) => ({
    name: bot.name,
    url: bot.origin,
    username: bot.username,
    password: bot.password,
  }));
  await kv.put(BOTS_KV_KEY, JSON.stringify(stored));
  kvCache.delete(kv);
  currentState = null;

  return json({ ok: true }, 200, NO_STORE);
}

function adminPage(): Response {
  return new Response(adminPageHtml(ADMIN_BASE), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

type BodyResult = { ok: true; body?: Uint8Array } | { ok: false };

/** Reads at most MAX_BODY_BYTES, checking both the declared and the actual length. */
async function readLimitedBody(request: Request): Promise<BodyResult> {
  const declared = request.headers.get('content-length');
  if (declared != null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { ok: false };
  }
  if (!request.body) return { ok: true };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { ok: true };

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

type ProxyState = {
  raw: string;
  botFor(id: string): BotConfig | undefined;
  listBots(): Promise<ListedBot[]>;
  forward(request: Request, url: URL, bot: BotConfig): Promise<Response>;
};

type Catalog = { at: number; ttl: number; bots: ListedBot[] };

function createProxyState(raw: string): ProxyState {
  let bots: BotConfig[];
  try {
    bots = loadBotConfigs(raw);
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : 'BOTS_CONFIG 无效');
  }

  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const sessions = new Map<string, Session>();
  const renewing = new Map<string, Promise<Session>>();
  const remembered = new Map<string, { at: number; listed: ListedBot }>();
  let catalog: Catalog | null = null;
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

  async function forward(request: Request, url: URL, bot: BotConfig): Promise<Response> {
    const method = request.method.toUpperCase();
    if (!isReadOnly(method, url.pathname)) {
      return json({ detail: '这个面板只读' }, 403);
    }

    let body: Uint8Array | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const read = await readLimitedBody(request);
      if (!read.ok) return json({ detail: '请求体过大' }, 413);
      body = read.body;
    }

    const target = `${bot.origin}${url.pathname}${url.search}`;
    const send = (session: Session) =>
      fetch(target, {
        method,
        headers: {
          Authorization: `Bearer ${session.access}`,
          ...(body && body.byteLength > 0 ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body && body.byteLength > 0 ? (body as BodyInit) : undefined,
        signal: AbortSignal.timeout(25_000),
      });

    let session = await ensureSession(bot);
    let upstream = await send(session);
    if (upstream.status === 401) {
      session = await ensureSession(bot, true);
      upstream = await send(session);
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    // These statuses must not carry a body, even an empty one.
    if (upstream.status === 204 || upstream.status === 205 || upstream.status === 304) {
      return new Response(null, { status: upstream.status, headers });
    }
    const payload = new Uint8Array(await upstream.arrayBuffer());
    return new Response(payload, { status: upstream.status, headers });
  }

  return { raw, botFor: (id) => byId.get(id), listBots, forward };
}

let currentState: ProxyState | null = null;

async function stateFor(env: WorkerEnv): Promise<ProxyState> {
  const { raw } = await resolveConfig(env);
  if (!raw) throw new BadRequestError('未配置 BOTS_CONFIG');
  if (currentState?.raw === raw) return currentState;
  const next = createProxyState(raw);
  currentState = next;
  return next;
}

/** Reject malformed percent-encoding before it reaches the proxy or the assets layer. */
function decodedPathname(url: URL): string {
  try {
    decodeURIComponent(url.pathname);
  } catch {
    throw new BadRequestError('请求路径无效');
  }
  return url.pathname;
}

async function route(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const pathname = decodedPathname(url);

  if (pathname === '/healthz') {
    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
  }

  // The page itself is public and contains no config; every API call is guarded.
  if (pathname === ADMIN_BASE || pathname === `${ADMIN_BASE}/`) return adminPage();

  if (pathname === `${ADMIN_BASE}/api/config`) {
    const denied = adminDenied(request, env);
    if (denied) return denied;
    if (request.method === 'GET') return getAdminConfig(env);
    if (request.method === 'PUT') return putAdminConfig(request, env);
    return json({ detail: '方法不支持' }, 405, NO_STORE);
  }

  if (pathname.startsWith(`${ADMIN_BASE}/api/`)) {
    const denied = adminDenied(request, env);
    if (denied) return denied;
    return json({ detail: '未找到' }, 404, NO_STORE);
  }

  if (pathname.startsWith(`${ADMIN_BASE}/`)) {
    return json({ detail: '未找到' }, 404, NO_STORE);
  }

  if (pathname.startsWith('/local/bots')) {
    const state = await stateFor(env);
    try {
      const listed = await state.listBots();
      return json(listed, 200, { 'Cache-Control': 'no-store' });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : '无法读取实盘列表', { status: 500 });
    }
  }

  if (pathname.startsWith('/api/')) {
    const state = await stateFor(env);
    const id = request.headers.get('x-ft-bot');
    const bot = id ? state.botFor(id) : undefined;
    if (!bot) return json({ detail: '未知实盘' }, 400);
    try {
      return await state.forward(request, url, bot);
    } catch (error) {
      if (error instanceof BadRequestError) return json({ detail: error.message }, 400);
      return json({ detail: error instanceof Error ? error.message : '实盘不可达' }, 502);
    }
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response('Not Found', { status: 404 });
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof BadRequestError) return json({ detail: error.message }, 400);
    return json({ detail: error instanceof Error ? error.message : '无法处理请求' }, 500);
  }
}
