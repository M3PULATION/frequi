import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_BODY_BYTES,
  accessTokenUsable,
  basicAuth,
  botIdFromOrigin,
  describeFallback,
  handleRequest,
  jwtExpiryMs,
  loadBotConfigs,
  normalizeBotUrl,
} from '../worker/core';

function token(expSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `x.${body}.y`;
}

function configFor(url = 'http://127.0.0.1:9', tag = ''): { raw: string; id: string } {
  const raw = JSON.stringify([{ name: `演示${tag}`, url, username: 'freqtrader', password: 'secret' }]);
  return { raw, id: loadBotConfigs(raw)[0]!.id };
}

function call(path: string, init?: RequestInit, botConfig = configFor()) {
  return handleRequest(new Request(`http://terminal.test${path}`, init), { BOTS_CONFIG: botConfig.raw });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker helpers', () => {
  it('reads exp from a base64url JWT payload', () => {
    const now = 1_700_000_000_000;
    const exp = Math.floor(now / 1000) + 120;
    expect(jwtExpiryMs(token(exp))).toBe(exp * 1000);
    expect(jwtExpiryMs('not-a-jwt')).toBeNull();
  });

  it('keeps access tokens until a minute before expiry', () => {
    const now = 1_700_000_000_000;
    expect(accessTokenUsable(token(Math.floor(now / 1000) + 120), now)).toBe(true);
    expect(accessTokenUsable(token(Math.floor(now / 1000) + 30), now)).toBe(false);
  });

  it('builds basic auth with UTF-8 credentials', () => {
    const expected = `Basic ${Buffer.from('频:密', 'utf8').toString('base64')}`;
    expect(basicAuth('频', '密')).toBe(expected);
  });

  it('normalizes bot urls and ids like the Node proxy', () => {
    expect(normalizeBotUrl('us.vxtrans.com:2894/dashboard')).toBe('http://us.vxtrans.com:2894');
    expect(botIdFromOrigin('http://us.vxtrans.com:2894')).toBe('us-vxtrans-com-2894');
  });

  it('keeps the previous strategy during a catalog blip', () => {
    const listed = { id: 'a', name: 'A', strategy: 'Martingale', botName: 'bot', host: 'h', online: true };
    expect(describeFallback({ at: 0, listed }, 60_000)).toEqual(listed);
    expect(describeFallback({ at: 0, listed }, 3 * 60_000)).toMatchObject({ online: false, strategy: 'Martingale' });
  });
});

describe('worker routes', () => {
  it('serves healthz without touching the bot config', async () => {
    const response = await handleRequest(new Request('http://terminal.test/healthz'), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('lists configured bots as offline when they cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const bot = configFor();
    const response = await call('/local/bots', undefined, bot);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: bot.id, name: '演示', strategy: '', botName: '', host: '127.0.0.1:9', online: false },
    ]);
  });

  it('rejects an unknown bot', async () => {
    const response = await call('/api/v1/status', { headers: { 'x-ft-bot': 'missing' } }, configFor('http://127.0.0.1:9', 'unknown'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ detail: '未知实盘' });
  });

  it('rejects writes to the read-only panel', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bot = configFor('http://127.0.0.1:9', 'write');
    const response = await call('/api/v1/stopbuy', { method: 'POST', headers: { 'x-ft-bot': bot.id } }, bot);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ detail: '这个面板只读' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies', async () => {
    const bot = configFor('http://127.0.0.1:9', 'big');
    const response = await call(
      '/api/v1/pair_candles',
      { method: 'POST', headers: { 'x-ft-bot': bot.id }, body: 'x'.repeat(MAX_BODY_BYTES + 1) },
      bot,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ detail: '请求体过大' });
  });

  it('forces one session refresh after a 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    let statusCalls = 0;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/v1/token/login')) {
        return Response.json({ access_token: token(now + 600), refresh_token: 'refresh-1' });
      }
      if (url.endsWith('/api/v1/token/refresh')) {
        return Response.json({ access_token: token(now + 600), refresh_token: 'refresh-2' });
      }
      statusCalls += 1;
      if (statusCalls === 1) return new Response(null, { status: 401 });
      return Response.json({ ok: true });
    }));
    const bot = configFor('http://127.0.0.1:9', 'refresh');
    const response = await call('/api/v1/status', { headers: { 'x-ft-bot': bot.id } }, bot);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls.filter((url) => url.endsWith('/api/v1/token/refresh'))).toHaveLength(1);
    expect(statusCalls).toBe(2);
  });

  it('returns 400 for malformed config and malformed paths', async () => {
    const badConfig = await handleRequest(new Request('http://terminal.test/local/bots'), { BOTS_CONFIG: '{}' });
    expect(badConfig.status).toBe(400);

    const badPath = await handleRequest(new Request('http://terminal.test/%'), {
      BOTS_CONFIG: configFor('http://127.0.0.1:9', 'path').raw,
    });
    expect(badPath.status).toBe(400);
  });
});
