import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ADMIN_PATH,
  ADMIN_MAX_FAILURES,
  BOTS_KV_KEY,
  adminPathConflict,
  constantTimeEqual,
  handleRequest,
  loadBotConfigs,
  normalizeAdminPath,
  resolveAdminBots,
  sanitizeBots,
  type BotKV,
  type WorkerEnv,
} from '../worker/core';

const ADMIN_TOKEN = 'admin-token-for-tests';
const PASSWORD = 'plaintext-password-42';

class FakeKV implements BotKV {
  data = new Map<string, string>();
  gets = 0;

  async get(key: string): Promise<string | null> {
    this.gets += 1;
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.20.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function sampleConfig(name = '示例机器人', password = PASSWORD): string {
  return JSON.stringify([{ name, url: 'http://127.0.0.1:9', username: 'freqtrader', password }]);
}

function token(expSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `x.${body}.y`;
}

function envFor(kv?: FakeKV, extra: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ADMIN_TOKEN,
    ...(kv ? { BOTS_KV: kv } : {}),
    ...extra,
  };
}

function adminCall(
  path: string,
  env: WorkerEnv,
  options: { method?: string; token?: string | null; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const headers = new Headers({ 'cf-connecting-ip': options.ip ?? nextIp() });
  if (options.token !== null) headers.set('authorization', `Bearer ${options.token ?? ADMIN_TOKEN}`);
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  return handleRequest(new Request(`http://terminal.test${path}`, init), env);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin authentication', () => {
  it('rejects a missing or wrong token with 401', async () => {
    const missing = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(), { token: null });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ detail: '令牌无效' });

    const wrong = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(), { token: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ detail: '令牌无效' });
  });

  it('returns 503 when ADMIN_TOKEN is not configured', async () => {
    const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(undefined, { ADMIN_TOKEN: undefined }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { detail: string; hint: string };
    expect(body.detail).toBe('未配置管理令牌');
    expect(body.hint).toContain('wrangler secret put ADMIN_TOKEN');
  });

  it('rate limits repeated failures per IP', async () => {
    const env = envFor();
    const ip = nextIp();
    for (let i = 0; i < ADMIN_MAX_FAILURES; i += 1) {
      const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: 'wrong', ip });
      expect(response.status).toBe(401);
    }
    const blocked = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: 'wrong', ip });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ detail: '尝试次数过多，请稍后再试' });

    // A correct token cannot bypass an active block.
    const stillBlocked = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: ADMIN_TOKEN, ip });
    expect(stillBlocked.status).toBe(429);
  });

  it('clears the failure counter after a successful login', async () => {
    const env = envFor();
    const ip = nextIp();
    expect((await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: 'wrong', ip })).status).toBe(401);
    expect((await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: ADMIN_TOKEN, ip })).status).toBe(200);
    expect((await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, { token: 'wrong', ip })).status).toBe(401);
  });
});

describe('admin page', () => {
  it('serves the page without a token and with no-store headers', async () => {
    const response = await handleRequest(new Request(`http://terminal.test${DEFAULT_ADMIN_PATH}`), envFor());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await response.text();
    expect(html).toContain('实盘配置管理');
    // The page script must call the private path, not a hardcoded one.
    expect(html).toContain(`${DEFAULT_ADMIN_PATH}/api/config`);
    expect(html).not.toContain(PASSWORD);
    expect(html).not.toContain(ADMIN_TOKEN);
  });

  it('serves the same page with a trailing slash', async () => {
    const response = await handleRequest(new Request(`http://terminal.test${DEFAULT_ADMIN_PATH}/`), envFor());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('实盘配置管理');
  });

  it('requires auth for unknown admin API paths', async () => {
    const denied = await adminCall(`${DEFAULT_ADMIN_PATH}/api/unknown`, envFor(), { token: null });
    expect(denied.status).toBe(401);

    const allowed = await adminCall(`${DEFAULT_ADMIN_PATH}/api/unknown`, envFor());
    expect(allowed.status).toBe(404);
  });
});

describe('admin path configuration', () => {
  it('serves the default path when ADMIN_PATH is not configured', async () => {
    const response = await handleRequest(new Request(`http://terminal.test${DEFAULT_ADMIN_PATH}`), envFor());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('实盘配置管理');
    expect(html).toContain(`${DEFAULT_ADMIN_PATH}/api/config`);
  });

  it('serves a custom path and stops serving the default one', async () => {
    const env = envFor(undefined, { ADMIN_PATH: '/secret-entry' });
    const page = await handleRequest(new Request('http://terminal.test/secret-entry'), env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('实盘配置管理');
    // The page script must use the configured path, not the default one.
    expect(html).toContain('/secret-entry/api/config');
    expect(html).not.toContain(`${DEFAULT_ADMIN_PATH}/api/config`);

    const api = await adminCall('/secret-entry/api/config', env);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ bots: [], source: 'none' });

    const defaultPath = await handleRequest(new Request(`http://terminal.test${DEFAULT_ADMIN_PATH}`), env);
    expect(defaultPath.status).toBe(404);
    expect(await defaultPath.text()).not.toContain('实盘配置管理');
  });

  it('falls back to the SPA for the default path when a custom path is configured', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('<!doctype html><html><body>spa</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    };
    const response = await handleRequest(
      new Request(`http://terminal.test${DEFAULT_ADMIN_PATH}`, { headers: { accept: 'text/html' } }),
      envFor(undefined, { ADMIN_PATH: '/secret-entry', ASSETS: assets }),
    );
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('spa');
    expect(html).not.toContain('实盘配置管理');
  });

  it('normalizes a missing leading slash and extra trailing slashes', async () => {
    expect(normalizeAdminPath('secret-entry')).toBe('/secret-entry');
    expect(normalizeAdminPath('/secret-entry/')).toBe('/secret-entry');
    expect(normalizeAdminPath('  /secret-entry//  ')).toBe('/secret-entry');
    expect(normalizeAdminPath('')).toBe(DEFAULT_ADMIN_PATH);
    expect(normalizeAdminPath(undefined)).toBe(DEFAULT_ADMIN_PATH);
    expect(normalizeAdminPath('/')).toBe(DEFAULT_ADMIN_PATH);

    const env = envFor(undefined, { ADMIN_PATH: 'secret-entry/' });
    const page = await handleRequest(new Request('http://terminal.test/secret-entry'), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/secret-entry/api/config');
  });
});

describe('admin config read', () => {
  it('never returns real passwords', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, sampleConfig());
    const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    const body = JSON.parse(text) as { bots: Array<Record<string, unknown>>; source: string };
    expect(body.source).toBe('kv');
    expect(body.bots).toHaveLength(1);
    expect(body.bots[0]).toMatchObject({ name: '示例机器人', url: 'http://127.0.0.1:9', password: null });
  });

  it('reads KV for both admin reads and proxy requests', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, sampleConfig('来自 KV', 'kv-password'));
    const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv));
    const body = (await response.json()) as { bots: Array<{ name: string }>; source: string };
    expect(body.source).toBe('kv');
    expect(body.bots[0]!.name).toBe('来自 KV');

    // The proxy path must use the same source.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const listed = await handleRequest(new Request('http://terminal.test/local/bots'), envFor(kv));
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as Array<{ name: string }>)[0]!.name).toBe('来自 KV');
  });

  it('reports source none when KV has no value', async () => {
    const empty = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(new FakeKV()));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ bots: [], source: 'none' });

    // A missing binding behaves the same way.
    const unbound = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor());
    expect(unbound.status).toBe(200);
    expect(await unbound.json()).toEqual({ bots: [], source: 'none' });
  });
});

describe('admin config write', () => {
  it('keeps the previous password when password is null or omitted', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, sampleConfig());
    const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: {
        bots: [
          { name: '保留密码', url: 'http://127.0.0.1:9/dashboard', username: 'freqtrader', password: null },
          { name: '省略密码', url: 'http://127.0.0.1:10', username: 'freqtrader' },
        ],
      },
    });
    expect(response.status).toBe(400); // second row has no previous config to inherit from

    const single = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '保留密码', url: 'http://127.0.0.1:9/dashboard', username: 'freqtrader', password: null }] },
    });
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ ok: true });

    const stored = JSON.parse(kv.data.get(BOTS_KV_KEY)!) as Array<Record<string, string>>;
    expect(stored[0]).toMatchObject({
      name: '保留密码',
      url: 'http://127.0.0.1:9',
      username: 'freqtrader',
      password: PASSWORD,
    });
  });

  it('uses a new password when one is supplied and hides it afterwards', async () => {
    const kv = new FakeKV();
    const nextPassword = 'brand-new-password';
    const saved = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '新密码', url: 'http://127.0.0.1:9', username: 'freqtrader', password: nextPassword }] },
    });
    expect(saved.status).toBe(200);

    const stored = JSON.parse(kv.data.get(BOTS_KV_KEY)!) as Array<Record<string, string>>;
    expect(stored[0]!.password).toBe(nextPassword);

    const read = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv));
    const text = await read.text();
    expect(text).not.toContain(nextPassword);
    expect((JSON.parse(text) as { source: string }).source).toBe('kv');

    const listed = await handleRequest(new Request('http://terminal.test/local/bots'), envFor(kv));
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as Array<{ name: string }>)[0]!.name).toBe('新密码');
  });

  it('invalidates the KV cache so a save is visible immediately', async () => {
    const kv = new FakeKV();
    const env = envFor(kv);
    const first = (await (await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env)).json()) as { source: string };
    expect(first.source).toBe('none');

    await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env, {
      method: 'PUT',
      body: { bots: [{ name: '刚保存', url: 'http://127.0.0.1:9', username: 'freqtrader', password: PASSWORD }] },
    });

    const after = (await (await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, env)).json()) as {
      source: string;
      bots: Array<{ name: string }>;
    };
    expect(after.source).toBe('kv');
    expect(after.bots[0]!.name).toBe('刚保存');
  });

  it('reads KV at most once per cache window for proxy requests', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, sampleConfig('缓存中的机器人'));
    const env = envFor(kv);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    await handleRequest(new Request('http://terminal.test/local/bots'), env);
    await handleRequest(new Request('http://terminal.test/local/bots'), env);
    expect(kv.gets).toBe(1);
  });

  it('rejects invalid config with 400 and never echoes the password', async () => {
    const kv = new FakeKV();
    const bad = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '', url: 'http://127.0.0.1:9', username: 'freqtrader', password: PASSWORD }] },
    });
    expect(bad.status).toBe(400);
    const badText = await bad.text();
    expect(badText).not.toContain(PASSWORD);
    expect(JSON.parse(badText).detail).toContain('缺少 name');
    expect(kv.data.has(BOTS_KV_KEY)).toBe(false);

    const badUrl = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '坏地址', url: 'http://bad host', username: 'freqtrader', password: PASSWORD }] },
    });
    expect(badUrl.status).toBe(400);
    expect(await badUrl.text()).not.toContain(PASSWORD);

    const notArray = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: { password: PASSWORD } },
    });
    expect(notArray.status).toBe(400);
    expect(await notArray.text()).not.toContain(PASSWORD);
  });

  it('returns 503 when the KV binding is missing', async () => {
    const response = await adminCall(`${DEFAULT_ADMIN_PATH}/api/config`, envFor(), {
      method: 'PUT',
      body: { bots: [] },
    });
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('KV');
  });
});

describe('admin helpers', () => {
  it('compares tokens in constant time', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });

  it('never includes passwords when sanitizing', () => {
    const bots = sanitizeBots(loadBotConfigs(sampleConfig()));
    expect(JSON.stringify(bots)).not.toContain(PASSWORD);
    expect(bots[0]!.password).toBeNull();
  });

  it('keeps the password while the row still points at the same bot', () => {
    const previous = loadBotConfigs(sampleConfig());
    const kept = resolveAdminBots(
      [{ name: '改名', url: 'http://127.0.0.1:9', username: 'freqtrader', password: null }],
      previous,
    );
    expect(kept[0]!.password).toBe(PASSWORD);

    // A trailing slash / /dashboard suffix still normalizes to the same origin.
    const normalized = resolveAdminBots(
      [{ name: '改名', url: 'http://127.0.0.1:9/dashboard/', username: 'freqtrader', password: null }],
      previous,
    );
    expect(normalized[0]!.password).toBe(PASSWORD);

    const replaced = resolveAdminBots(
      [{ name: '改名', url: 'http://127.0.0.1:9', username: 'freqtrader', password: 'next-password' }],
      previous,
    );
    expect(replaced[0]!.password).toBe('next-password');
  });

  it('refuses to reuse a password after the host changes', () => {
    const previous = loadBotConfigs(sampleConfig());
    // This is the attack: repoint the row at another host and let the blank
    // password inherit the previous bot's credential.
    expect(() =>
      resolveAdminBots(
        [{ name: '别的机器', url: 'http://127.0.0.1:9999', username: 'freqtrader', password: null }],
        previous,
      ),
    ).toThrow('第 1 台实盘需要重新填写 password');

    // Typing the password explicitly is still allowed.
    const allowed = resolveAdminBots(
      [{ name: '别的机器', url: 'http://127.0.0.1:9999', username: 'freqtrader', password: 'fresh' }],
      previous,
    );
    expect(allowed[0]!.password).toBe('fresh');
    expect(allowed[0]!.origin).toBe('http://127.0.0.1:9999');
  });

  it('refuses to reuse a password after the username changes', () => {
    const previous = loadBotConfigs(sampleConfig());
    expect(() =>
      resolveAdminBots(
        [{ name: '同名主机', url: 'http://127.0.0.1:9', username: 'someone-else', password: null }],
        previous,
      ),
    ).toThrow('第 1 台实盘需要重新填写 password');
  });

  it('does not hand a password to a row that moved position', () => {
    const previous = loadBotConfigs(
      JSON.stringify([
        { name: 'A', url: 'http://127.0.0.1:9', username: 'userA', password: 'passA' },
        { name: 'B', url: 'http://127.0.0.1:10', username: 'userB', password: 'passB' },
      ]),
    );
    const reordered = resolveAdminBots(
      [
        { name: 'B', url: 'http://127.0.0.1:10', username: 'userB', password: null },
        { name: 'A', url: 'http://127.0.0.1:9', username: 'userA', password: null },
      ],
      previous,
    );
    expect(reordered[0]!.password).toBe('passB');
    expect(reordered[1]!.password).toBe('passA');
  });

  it('requires a password for a brand new bot', () => {
    const previous = loadBotConfigs(sampleConfig());
    expect(() =>
      resolveAdminBots(
        [
          { name: '第一台', url: 'http://127.0.0.1:9', username: 'freqtrader', password: null },
          { name: '第二台', url: 'http://127.0.0.1:10', username: 'freqtrader', password: null },
        ],
        previous,
      ),
    ).toThrow('第 2 台实盘需要重新填写 password');
  });

  it('never echoes a password in a validation error', () => {
    const previous = loadBotConfigs(sampleConfig());
    let message = '';
    try {
      resolveAdminBots(
        [{ name: '坏配置', url: 'not a url at all', username: 'x', password: 'LeakMe999' }],
        previous,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBeTruthy();
    expect(message).not.toContain('LeakMe999');
  });
});

describe('reserved path conflicts', () => {
  it('detects equal, prefix and nested admin paths but not look-alikes', () => {
    expect(adminPathConflict('/api')).toBe('/api');
    expect(adminPathConflict('/local')).toBe('/local');
    expect(adminPathConflict('/healthz')).toBe('/healthz');

    // A prefix of a reserved path, before or after normalization.
    expect(adminPathConflict('/ap')).toBe('/api');
    expect(adminPathConflict('api')).toBe('/api');
    expect(adminPathConflict('/api/')).toBe('/api');

    // An admin path inside a reserved namespace, whose fallback would swallow
    // part of the proxy.
    expect(adminPathConflict('/api/v1')).toBe('/api');
    expect(adminPathConflict('/local/private')).toBe('/local');

    // Different routes that merely share characters are valid.
    expect(adminPathConflict('/apiary')).toBeNull();
    expect(adminPathConflict('/localbots')).toBeNull();
    expect(adminPathConflict('/healthz-backup')).toBeNull();
    expect(adminPathConflict('/admin')).toBeNull();
    expect(adminPathConflict('/my-private-entry')).toBeNull();
    expect(adminPathConflict(undefined)).toBeNull();
    expect(adminPathConflict('')).toBeNull();
  });

  it('keeps proxy, bot list and healthz routes working under every conflicting path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    for (const adminPath of ['/api', '/local', '/healthz']) {
      const kv = new FakeKV();
      kv.data.set(BOTS_KV_KEY, sampleConfig(`保留路由 ${adminPath}`));
      const env = envFor(kv, { ADMIN_PATH: adminPath });

      const health = await handleRequest(new Request('http://terminal.test/healthz'), env);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const listed = await handleRequest(new Request('http://terminal.test/local/bots'), env);
      expect(listed.status).toBe(200);
      expect(Array.isArray(await listed.json())).toBe(true);

      // The exact reproduction: this used to be swallowed by the admin fallback.
      const proxied = await handleRequest(
        new Request('http://terminal.test/api/v1/show_config', { headers: { 'x-ft-bot': 'missing' } }),
        env,
      );
      expect(proxied.status).toBe(400);
      expect(await proxied.json()).toEqual({ detail: '未知实盘' });
    }
  });

  it('forwards /api/* to the selected bot when ADMIN_PATH=/api', async () => {
    const raw = sampleConfig('转发测试');
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, raw);
    const id = loadBotConfigs(raw)[0]!.id;
    const now = Math.floor(Date.now() / 1000);
    const calls: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/v1/token/login')) {
        return Response.json({ access_token: token(now + 600), refresh_token: 'refresh-1' });
      }
      if (url.endsWith('/api/v1/show_config')) {
        return Response.json({ strategy: 'ProxyStrategy' });
      }
      return new Response(null, { status: 404 });
    }));

    const response = await handleRequest(
      new Request('http://terminal.test/api/v1/show_config', { headers: { 'x-ft-bot': id } }),
      envFor(kv, { ADMIN_PATH: '/api' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ strategy: 'ProxyStrategy' });
    expect(calls.some((url) => url.endsWith('/api/v1/show_config'))).toBe(true);
  });

  it('answers on the misconfigured admin path with an explicit 503', async () => {
    const api = await handleRequest(
      new Request('http://terminal.test/api'),
      envFor(new FakeKV(), { ADMIN_PATH: '/api' }),
    );
    expect(api.status).toBe(503);
    const apiBody = (await api.json()) as { detail: string; hint: string };
    expect(apiBody.detail).toContain('ADMIN_PATH');
    expect(apiBody.hint).toContain('/api');
    expect(apiBody.hint).toContain('wrangler.jsonc');

    // The admin API of a /local entry is unreachable, but /local/bots is not.
    const localApi = await handleRequest(
      new Request('http://terminal.test/local/api/config'),
      envFor(new FakeKV(), { ADMIN_PATH: '/local' }),
    );
    expect(localApi.status).toBe(503);

    // /healthz keeps serving health; only the admin API under it is disabled.
    const env = envFor(new FakeKV(), { ADMIN_PATH: '/healthz' });
    expect((await handleRequest(new Request('http://terminal.test/healthz'), env)).status).toBe(200);
    const healthApi = await handleRequest(new Request('http://terminal.test/healthz/api/config'), env);
    expect(healthApi.status).toBe(503);
  });

  it('keeps the admin page and API working for normal and look-alike paths', async () => {
    for (const adminPath of ['/admin', '/my-private-entry', '/apiary']) {
      const kv = new FakeKV();
      kv.data.set(BOTS_KV_KEY, sampleConfig());
      const env = envFor(kv, { ADMIN_PATH: adminPath });

      const page = await handleRequest(new Request(`http://terminal.test${adminPath}`), env);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('实盘配置管理');
      expect(html).toContain(`${adminPath}/api/config`);

      const config = await adminCall(`${adminPath}/api/config`, env);
      expect(config.status).toBe(200);
      expect(((await config.json()) as { source: string }).source).toBe('kv');
    }
  });
});
