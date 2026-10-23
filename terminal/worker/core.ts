/**
 * Cloudflare Workers logic for the read-only Freqtrade terminal.
 *
 * Uses Web APIs only: it serves the admin page, proxies read-only Freqtrade
 * requests, and keeps bot configuration in KV.
 */

import { adminPageHtml } from './adminPage';
import { localDocHtml } from './localDoc';
import { OPENAPI_DOCUMENT } from './openapi';

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

export type BotSource = 'kv' | 'none';

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
  /** KV namespace holding the editable config under the `bots` key. */
  BOTS_KV?: BotKV;
  /** Bearer token for the admin API. */
  ADMIN_TOKEN?: string;
  /**
   * Path that serves the config page and prefixes its API. Configured by the
   * deployer through the `ADMIN_PATH` var; falls back to DEFAULT_ADMIN_PATH.
   */
  ADMIN_PATH?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

const READONLY_POST = new Set(['/api/v1/pair_candles', '/api/v1/pair_history']);

/** Convenience reads: `/local/bots/:id/<action>` → the matching freqtrade endpoint. */
const LOCAL_BOT_ROUTE = /^\/local\/bots\/([^/]+)\/(status|balance|profit|trades)$/;
const LOCAL_BOT_UPSTREAM: Record<string, string> = {
  status: '/api/v1/status',
  balance: '/api/v1/balance',
  profit: '/api/v1/profit',
  trades: '/api/v1/trades',
};

/**
 * Default path for the config page and its API. Deployers override it with the
 * `ADMIN_PATH` var in wrangler.jsonc. This constant is only the fallback (and
 * the value the tests use); it is not a security boundary.
 */
export const DEFAULT_ADMIN_PATH = '/admin';

/**
 * Paths the worker always owns. The admin entry must not overlap them: its
 * generic prefix branch would otherwise swallow proxy requests (this is what
 * happened with ADMIN_PATH=/api, where `/api/v1/show_config` returned 404).
 */
export const RESERVED_PATHS = ['/api', '/local', '/healthz'] as const;

/**
 * Normalize a configured admin path: trim whitespace, add a missing leading
 * slash, and drop trailing slashes. An empty value falls back to the default.
 * Exported so the rule can be unit tested directly.
 */
export function normalizeAdminPath(input?: string | null): string {
  const value = (input ?? '').trim();
  if (!value) return DEFAULT_ADMIN_PATH;
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  const trimmed = withLeadingSlash.replace(/\/+$/, '');
  return trimmed || DEFAULT_ADMIN_PATH;
}

/**
 * Return the reserved path an admin entry collides with, or null when it is
 * safe. Two shapes collide:
 *
 * - the admin path is a prefix of a reserved path (`/api` and `/ap`, while
 *   `/apiary` is not because it extends `/api` instead of being a prefix);
 * - the admin path lives inside a reserved namespace (`/api/v1`), whose
 *   generic admin fallback would swallow that part of the proxy.
 *
 * The comparison is path-aware: `/apiary` shares characters with `/api` but
 * is a different route, so it stays valid.
 */
export function adminPathConflict(input?: string | null): string | null {
  const base = normalizeAdminPath(input);
  for (const reserved of RESERVED_PATHS) {
    if (reserved.startsWith(base) || base.startsWith(`${reserved}/`)) return reserved;
  }
  return null;
}

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
  if (!Array.isArray(parsed)) throw new Error('机器人配置必须是数组');
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
/** Aggregate reads time out quickly so one slow bot cannot stall /local/overview. */
export const LOCAL_UPSTREAM_TIMEOUT_MS = 5_000;

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
    // A KV outage should not take the terminal down; treat it as no config.
    raw = null;
  }
  kvCache.set(kv, { at: now, raw });
  return raw;
}

async function resolveConfig(env: WorkerEnv, now = Date.now()): Promise<{ raw: string | null; source: BotSource }> {
  const fromKv = await kvRaw(env, now);
  if (fromKv) return { raw: fromKv, source: 'kv' };
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

/**
 * A conflicting ADMIN_PATH disables the admin page rather than silently
 * falling back to /admin: the deployer must know its configuration was
 * rejected. The reserved routes themselves are matched before this response,
 * so they keep working under any ADMIN_PATH.
 */
function adminPathConflictResponse(adminBase: string, reserved: string): Response {
  return json(
    {
      detail: 'ADMIN_PATH 与保留路径冲突，管理页已禁用',
      hint: `ADMIN_PATH=${adminBase} 与 ${reserved} 冲突，请修改 wrangler.jsonc 中的 vars.ADMIN_PATH`,
    },
    503,
    NO_STORE,
  );
}

function adminPage(base: string): Response {
  return new Response(adminPageHtml(base), {
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

function localDocPage(): Response {
  return new Response(localDocHtml(), {
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
  getJson(bot: BotConfig, pathname: string): Promise<unknown>;
  forward(request: Request, url: URL, bot: BotConfig): Promise<Response>;
};

type Catalog = { at: number; ttl: number; bots: ListedBot[] };

function createProxyState(raw: string): ProxyState {
  let bots: BotConfig[];
  try {
    bots = loadBotConfigs(raw);
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : '机器人配置无效');
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

  /**
   * One authenticated read against a bot, renewing the session once on 401.
   * The upstream path is built here so callers cannot smuggle a host.
   */
  async function authedFetch(
    bot: BotConfig,
    pathname: string,
    search: string,
    init: { method: string; body?: Uint8Array; timeoutMs: number },
  ): Promise<Response> {
    const target = `${bot.origin}${pathname}${search}`;
    const send = (session: Session) =>
      fetch(target, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${session.access}`,
          ...(init.body && init.body.byteLength > 0 ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body && init.body.byteLength > 0 ? (init.body as BodyInit) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs),
      });

    let session = await ensureSession(bot);
    let upstream = await send(session);
    if (upstream.status === 401) {
      session = await ensureSession(bot, true);
      upstream = await send(session);
    }
    return upstream;
  }

  /** Read one JSON endpoint. Transport errors and non-2xx responses throw. */
  async function getJson(bot: BotConfig, pathname: string): Promise<unknown> {
    const upstream = await authedFetch(bot, pathname, '', {
      method: 'GET',
      timeoutMs: LOCAL_UPSTREAM_TIMEOUT_MS,
    });
    if (!upstream.ok) throw new Error(String(upstream.status));
    return upstream.json();
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

    const upstream = await authedFetch(bot, url.pathname, url.search, {
      method,
      body,
      timeoutMs: 25_000,
    });

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

  return { raw, botFor: (id) => byId.get(id), listBots, getJson, forward };
}

let currentState: ProxyState | null = null;

async function stateFor(env: WorkerEnv): Promise<ProxyState> {
  const { raw } = await resolveConfig(env);
  if (!raw) throw new BadRequestError('尚未配置机器人，请先在管理页添加');
  if (currentState?.raw === raw) return currentState;
  const next = createProxyState(raw);
  currentState = next;
  return next;
}

type OverviewBot = ListedBot & { status: unknown; profit: unknown; balance: unknown };

/**
 * One aggregate snapshot for every configured bot.
 *
 * Each field is fetched independently and failures collapse to `null`, so one
 * unreachable or older bot (for example one without /api/v1/balance) never
 * breaks the response for the others. Offline bots are not probed again: the
 * catalog already told us they are down.
 */
async function buildOverview(state: ProxyState): Promise<Response> {
  const listed = await state.listBots();
  const bots = await Promise.all(
    listed.map(async (bot): Promise<OverviewBot> => {
      const config = state.botFor(bot.id);
      if (!config || !bot.online) {
        return { ...bot, status: null, profit: null, balance: null };
      }
      const [status, profit, balance] = await Promise.all([
        state.getJson(config, '/api/v1/status').catch(() => null),
        state.getJson(config, '/api/v1/profit').catch(() => null),
        state.getJson(config, '/api/v1/balance').catch(() => null),
      ]);
      return { ...bot, status, profit, balance };
    }),
  );
  return json({ generatedAt: new Date().toISOString(), bots }, 200, NO_STORE);
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
  const adminBase = normalizeAdminPath(env.ADMIN_PATH);
  const adminConflict = adminPathConflict(adminBase);

  // Reserved routes come first, so an overlapping ADMIN_PATH can never shadow
  // them. This is the core of the fix: with ADMIN_PATH=/api the admin prefix
  // branch used to swallow every /api/* request.
  if (pathname === '/healthz') {
    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
  }

  if (pathname === '/openapi.json') {
    return json(OPENAPI_DOCUMENT, 200, NO_STORE);
  }

  if (pathname === '/local/doc') {
    return localDocPage();
  }

  if (pathname === '/local/overview') {
    const state = await stateFor(env);
    return buildOverview(state);
  }

  // Must come before the generic `/local/bots` prefix branch below, otherwise
  // the prefix would answer these reads with the bot catalog.
  const localBot = LOCAL_BOT_ROUTE.exec(pathname);
  if (localBot) {
    const state = await stateFor(env);
    let id: string;
    try {
      id = decodeURIComponent(localBot[1]!);
    } catch {
      return json({ detail: '未知实盘' }, 404, NO_STORE);
    }
    const bot = state.botFor(id);
    if (!bot) return json({ detail: '未知实盘' }, 404, NO_STORE);

    // Remap only the path; a query string such as ?limit=20 passes through.
    const target = new URL(request.url);
    target.pathname = LOCAL_BOT_UPSTREAM[localBot[2]!]!;
    try {
      return await state.forward(request, target, bot);
    } catch (error) {
      if (error instanceof BadRequestError) return json({ detail: error.message }, 400, NO_STORE);
      return json({ detail: error instanceof Error ? error.message : '实盘不可达' }, 502, NO_STORE);
    }
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

  if (adminConflict) {
    // Admin routing is disabled. The reserved branches above already won any
    // overlap, so these paths are unambiguously the misconfigured admin entry.
    if (pathname === adminBase || pathname.startsWith(`${adminBase}/`)) {
      return adminPathConflictResponse(adminBase, adminConflict);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }

  // The page itself is public and contains no config; every API call is guarded.
  if (pathname === adminBase || pathname === `${adminBase}/`) return adminPage(adminBase);

  if (pathname === `${adminBase}/api/config`) {
    const denied = adminDenied(request, env);
    if (denied) return denied;
    if (request.method === 'GET') return getAdminConfig(env);
    if (request.method === 'PUT') return putAdminConfig(request, env);
    return json({ detail: '方法不支持' }, 405, NO_STORE);
  }

  if (pathname.startsWith(`${adminBase}/api/`)) {
    const denied = adminDenied(request, env);
    if (denied) return denied;
    return json({ detail: '未找到' }, 404, NO_STORE);
  }

  if (pathname.startsWith(`${adminBase}/`)) {
    return json({ detail: '未找到' }, 404, NO_STORE);
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
