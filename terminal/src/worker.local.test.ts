import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOTS_KV_KEY, handleRequest, loadBotConfigs, type BotKV, type WorkerEnv } from '../worker/core';
import { OPENAPI_DOCUMENT } from '../worker/openapi';

/** Minimal in-memory stand-in for the BOTS_KV binding. */
function memoryKv(initial?: string): BotKV {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(BOTS_KV_KEY, initial);
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

function envWith(raw?: string): WorkerEnv {
  return { BOTS_KV: memoryKv(raw) };
}

function token(expSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `x.${body}.y`;
}

type BotSpec = { name: string; url: string };

function configFor(bots: BotSpec[]): { raw: string; ids: string[] } {
  const raw = JSON.stringify(
    bots.map((bot) => ({ name: bot.name, url: bot.url, username: 'freqtrader', password: 'secret' })),
  );
  return { raw, ids: loadBotConfigs(raw).map((bot) => bot.id) };
}

/** Fake freqtrade instance that records calls; `fail` selects endpoints to break. */
function stubUpstreams(fail?: (url: URL) => boolean) {
  const now = Math.floor(Date.now() / 1000);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/token/login') {
      return Response.json({ access_token: token(now + 600), refresh_token: 'refresh' });
    }
    if (url.pathname === '/api/v1/show_config') {
      return Response.json({ strategy: `S-${url.host}`, bot_name: `bot-${url.host}` });
    }
    if (fail?.(url)) throw new Error('upstream down');

    switch (url.pathname) {
      case '/api/v1/status':
        return Response.json([{ trade_id: 1, pair: 'BTC/USDT' }]);
      case '/api/v1/profit':
        return Response.json({ profit_all_coin: 1.5, trade_count: 2 });
      case '/api/v1/balance':
        return Response.json([{ currency: 'USDT', balance: 100 }]);
      case '/api/v1/trades':
        return Response.json({ trades: [], trades_count: 0 });
      default:
        throw new Error(`unexpected upstream path ${url.pathname}`);
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /local/overview', () => {
  it('keeps one failing field and one failing instance out of the other results', async () => {
    const bot = configFor([
      { name: 'Alpha', url: 'http://alpha-overview.example' },
      { name: 'Beta', url: 'http://beta-overview.example' },
      { name: 'Gamma', url: 'http://gamma-overview.example' },
    ]);
    // Beta fails every aggregate call; Gamma only fails status and balance.
    vi.stubGlobal('fetch', stubUpstreams((url) => {
      if (url.host === 'beta-overview.example') return true;
      if (url.host === 'gamma-overview.example') {
        return url.pathname === '/api/v1/status' || url.pathname === '/api/v1/balance';
      }
      return false;
    }));

    const response = await handleRequest(new Request('http://terminal.test/local/overview'), envWith(bot.raw));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as {
      generatedAt: string;
      bots: Array<{
        name: string;
        online: boolean;
        strategy: string;
        status: unknown;
        profit: unknown;
        balance: unknown;
      }>;
    };

    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);

    const alpha = body.bots.find((item) => item.name === 'Alpha')!;
    expect(alpha).toMatchObject({ online: true, strategy: 'S-alpha-overview.example' });
    expect(alpha.status).toEqual([{ trade_id: 1, pair: 'BTC/USDT' }]);
    expect(alpha.profit).toMatchObject({ profit_all_coin: 1.5, trade_count: 2 });
    expect(alpha.balance).toEqual([{ currency: 'USDT', balance: 100 }]);

    const beta = body.bots.find((item) => item.name === 'Beta')!;
    expect(beta).toMatchObject({ online: true, status: null, profit: null, balance: null });

    const gamma = body.bots.find((item) => item.name === 'Gamma')!;
    expect(gamma).toMatchObject({ status: null, balance: null });
    expect(gamma.profit).toMatchObject({ profit_all_coin: 1.5 });
  });

  it('returns null fields for a bot that is offline during the catalog probe', async () => {
    const bot = configFor([{ name: 'Delta', url: 'http://delta-overview.example' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const response = await handleRequest(new Request('http://terminal.test/local/overview'), envWith(bot.raw));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { bots: Array<Record<string, unknown>> };
    expect(body.bots).toEqual([
      {
        id: bot.ids[0],
        name: 'Delta',
        strategy: '',
        botName: '',
        host: 'delta-overview.example',
        online: false,
        status: null,
        profit: null,
        balance: null,
      },
    ]);
  });
});

describe('single-bot convenience routes', () => {
  it('returns 404 for an unknown bot without calling any upstream', async () => {
    const bot = configFor([{ name: 'Known', url: 'http://known-route.example' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRequest(
      new Request('http://terminal.test/local/bots/does-not-exist/status'),
      envWith(bot.raw),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: '未知实盘' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies /trades and passes the query string through', async () => {
    const bot = configFor([{ name: 'Proxy', url: 'http://proxy-route.example' }]);
    const fetchMock = stubUpstreams();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRequest(
      new Request(`http://terminal.test/local/bots/${bot.ids[0]}/trades?limit=7`),
      envWith(bot.raw),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trades: [], trades_count: 0 });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain('http://proxy-route.example/api/v1/trades?limit=7');
  });

  it('maps status and profit to their freqtrade endpoints', async () => {
    const bot = configFor([{ name: 'Mapping', url: 'http://mapping-route.example' }]);
    const fetchMock = stubUpstreams();
    vi.stubGlobal('fetch', fetchMock);

    const status = await handleRequest(
      new Request(`http://terminal.test/local/bots/${bot.ids[0]}/status`),
      envWith(bot.raw),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual([{ trade_id: 1, pair: 'BTC/USDT' }]);

    const profit = await handleRequest(
      new Request(`http://terminal.test/local/bots/${bot.ids[0]}/profit`),
      envWith(bot.raw),
    );
    expect(profit.status).toBe(200);
    expect(await profit.json()).toMatchObject({ trade_count: 2 });
  });

  it('returns 502 when the upstream instance is unreachable', async () => {
    const bot = configFor([{ name: 'Down', url: 'http://down-route.example' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('unreachable');
    }));

    const response = await handleRequest(
      new Request(`http://terminal.test/local/bots/${bot.ids[0]}/balance`),
      envWith(bot.raw),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ detail: 'unreachable' });
  });
});

describe('route ordering', () => {
  it('leaves GET /local/bots serving the catalog', async () => {
    const bot = configFor([{ name: 'Listed', url: 'http://listed-order.example' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const response = await handleRequest(new Request('http://terminal.test/local/bots'), envWith(bot.raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: bot.ids[0],
        name: 'Listed',
        strategy: '',
        botName: '',
        host: 'listed-order.example',
        online: false,
      },
    ]);
  });
});

describe('documentation endpoints', () => {
  it('serves a parseable OpenAPI 3.1 document covering every local route', async () => {
    const response = await handleRequest(new Request('http://terminal.test/openapi.json'), {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const doc = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(OPENAPI_DOCUMENT.openapi).toBe('3.1.0');

    for (const path of [
      '/healthz',
      '/local/bots',
      '/local/overview',
      '/local/bots/{id}/status',
      '/local/bots/{id}/balance',
      '/local/bots/{id}/profit',
      '/local/bots/{id}/trades',
      '/local/doc',
      '/openapi.json',
    ]) {
      expect(doc.paths[path], `missing ${path}`).toBeDefined();
    }
    expect(doc.components.schemas.Overview).toBeDefined();
    expect(doc.components.schemas.OverviewBot).toBeDefined();
    expect(JSON.stringify(doc)).not.toContain('secret');
  });

  it('serves a Chinese HTML guide that links to /openapi.json', async () => {
    const response = await handleRequest(new Request('http://terminal.test/local/doc'), {});
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('/openapi.json');
    expect(html).toContain('/local/overview');
    expect(html).toContain('curl');
  });
});
