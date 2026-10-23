import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_BASE,
  ADMIN_MAX_FAILURES,
  BOTS_KV_KEY,
  constantTimeEqual,
  handleRequest,
  loadBotConfigs,
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

function secretConfig(name = '来自 Secret', password = PASSWORD): string {
  return JSON.stringify([{ name, url: 'http://127.0.0.1:9', username: 'freqtrader', password }]);
}

function envFor(kv?: FakeKV, extra: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ADMIN_TOKEN,
    BOTS_CONFIG: secretConfig(),
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
    const missing = await adminCall(`${ADMIN_BASE}/api/config`, envFor(), { token: null });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ detail: '令牌无效' });

    const wrong = await adminCall(`${ADMIN_BASE}/api/config`, envFor(), { token: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ detail: '令牌无效' });
  });

  it('returns 503 when ADMIN_TOKEN is not configured', async () => {
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor(undefined, { ADMIN_TOKEN: undefined }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { detail: string; hint: string };
    expect(body.detail).toBe('未配置管理令牌');
    expect(body.hint).toContain('wrangler secret put ADMIN_TOKEN');
  });

  it('rate limits repeated failures per IP', async () => {
    const env = envFor();
    const ip = nextIp();
    for (let i = 0; i < ADMIN_MAX_FAILURES; i += 1) {
      const response = await adminCall(`${ADMIN_BASE}/api/config`, env, { token: 'wrong', ip });
      expect(response.status).toBe(401);
    }
    const blocked = await adminCall(`${ADMIN_BASE}/api/config`, env, { token: 'wrong', ip });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ detail: '尝试次数过多，请稍后再试' });

    // A correct token cannot bypass an active block.
    const stillBlocked = await adminCall(`${ADMIN_BASE}/api/config`, env, { token: ADMIN_TOKEN, ip });
    expect(stillBlocked.status).toBe(429);
  });

  it('clears the failure counter after a successful login', async () => {
    const env = envFor();
    const ip = nextIp();
    expect((await adminCall(`${ADMIN_BASE}/api/config`, env, { token: 'wrong', ip })).status).toBe(401);
    expect((await adminCall(`${ADMIN_BASE}/api/config`, env, { token: ADMIN_TOKEN, ip })).status).toBe(200);
    expect((await adminCall(`${ADMIN_BASE}/api/config`, env, { token: 'wrong', ip })).status).toBe(401);
  });
});

describe('admin page', () => {
  it('serves the page without a token and with no-store headers', async () => {
    const response = await handleRequest(new Request(`http://terminal.test${ADMIN_BASE}`), envFor());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await response.text();
    expect(html).toContain('实盘配置管理');
    // The page script must call the private path, not a hardcoded one.
    expect(html).toContain(`${ADMIN_BASE}/api/config`);
    expect(html).not.toContain(PASSWORD);
    expect(html).not.toContain(ADMIN_TOKEN);
  });

  it('serves the same page with a trailing slash', async () => {
    const response = await handleRequest(new Request(`http://terminal.test${ADMIN_BASE}/`), envFor());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('实盘配置管理');
  });

  it('does not serve the config page from the old /admin path', async () => {
    const response = await handleRequest(new Request('http://terminal.test/admin'), envFor());
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toContain('实盘配置管理');
    expect(html).not.toContain('实盘配置管理 · MANIPULATION');
  });

  it('falls back to the SPA for /admin instead of serving the page', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('<!doctype html><html><body>spa</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    };
    const response = await handleRequest(
      new Request('http://terminal.test/admin', { headers: { accept: 'text/html' } }),
      envFor(undefined, { ASSETS: assets }),
    );
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('spa');
    expect(html).not.toContain('实盘配置管理');
  });

  it('requires auth for unknown admin API paths', async () => {
    const denied = await adminCall(`${ADMIN_BASE}/api/unknown`, envFor(), { token: null });
    expect(denied.status).toBe(401);

    const allowed = await adminCall(`${ADMIN_BASE}/api/unknown`, envFor());
    expect(allowed.status).toBe(404);
  });
});

describe('admin config read', () => {
  it('never returns real passwords', async () => {
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    const body = JSON.parse(text) as { bots: Array<Record<string, unknown>>; source: string };
    expect(body.source).toBe('secret');
    expect(body.bots).toHaveLength(1);
    expect(body.bots[0]).toMatchObject({ name: '来自 Secret', url: 'http://127.0.0.1:9', password: null });
  });

  it('prefers KV over the secret', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, secretConfig('来自 KV', 'kv-password'));
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv));
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

  it('falls back to the secret when KV has no value', async () => {
    const kv = new FakeKV();
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv));
    const body = (await response.json()) as { bots: Array<{ name: string }>; source: string };
    expect(body.source).toBe('secret');
    expect(body.bots[0]!.name).toBe('来自 Secret');
  });

  it('reports source none when neither store is configured', async () => {
    const response = await adminCall(
      `${ADMIN_BASE}/api/config`,
      envFor(undefined, { BOTS_CONFIG: undefined }),
      { token: ADMIN_TOKEN },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bots: [], source: 'none' });
  });
});

describe('admin config write', () => {
  it('keeps the previous password when password is null or omitted', async () => {
    const kv = new FakeKV();
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
      method: 'PUT',
      body: {
        bots: [
          { name: '保留密码', url: 'http://127.0.0.1:9/dashboard', username: 'freqtrader', password: null },
          { name: '省略密码', url: 'http://127.0.0.1:10', username: 'freqtrader' },
        ],
      },
    });
    expect(response.status).toBe(400); // second row has no previous config to inherit from

    const single = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
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
    const saved = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '新密码', url: 'http://127.0.0.1:9', username: 'freqtrader', password: nextPassword }] },
    });
    expect(saved.status).toBe(200);

    const stored = JSON.parse(kv.data.get(BOTS_KV_KEY)!) as Array<Record<string, string>>;
    expect(stored[0]!.password).toBe(nextPassword);

    const read = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv));
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
    const first = (await (await adminCall(`${ADMIN_BASE}/api/config`, env)).json()) as { source: string };
    expect(first.source).toBe('secret');

    await adminCall(`${ADMIN_BASE}/api/config`, env, {
      method: 'PUT',
      body: { bots: [{ name: '刚保存', url: 'http://127.0.0.1:9', username: 'freqtrader', password: PASSWORD }] },
    });

    const after = (await (await adminCall(`${ADMIN_BASE}/api/config`, env)).json()) as {
      source: string;
      bots: Array<{ name: string }>;
    };
    expect(after.source).toBe('kv');
    expect(after.bots[0]!.name).toBe('刚保存');
  });

  it('reads KV at most once per cache window for proxy requests', async () => {
    const kv = new FakeKV();
    kv.data.set(BOTS_KV_KEY, secretConfig('缓存中的机器人'));
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
    const bad = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '', url: 'http://127.0.0.1:9', username: 'freqtrader', password: PASSWORD }] },
    });
    expect(bad.status).toBe(400);
    const badText = await bad.text();
    expect(badText).not.toContain(PASSWORD);
    expect(JSON.parse(badText).detail).toContain('缺少 name');
    expect(kv.data.has(BOTS_KV_KEY)).toBe(false);

    const badUrl = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: [{ name: '坏地址', url: 'http://bad host', username: 'freqtrader', password: PASSWORD }] },
    });
    expect(badUrl.status).toBe(400);
    expect(await badUrl.text()).not.toContain(PASSWORD);

    const notArray = await adminCall(`${ADMIN_BASE}/api/config`, envFor(kv), {
      method: 'PUT',
      body: { bots: { password: PASSWORD } },
    });
    expect(notArray.status).toBe(400);
    expect(await notArray.text()).not.toContain(PASSWORD);
  });

  it('returns 503 when the KV binding is missing', async () => {
    const response = await adminCall(`${ADMIN_BASE}/api/config`, envFor(), {
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
    const bots = sanitizeBots(loadBotConfigs(secretConfig()));
    expect(JSON.stringify(bots)).not.toContain(PASSWORD);
    expect(bots[0]!.password).toBeNull();
  });

  it('keeps the password while the row still points at the same bot', () => {
    const previous = loadBotConfigs(secretConfig());
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
    const previous = loadBotConfigs(secretConfig());
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
    const previous = loadBotConfigs(secretConfig());
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
    const previous = loadBotConfigs(secretConfig());
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
    const previous = loadBotConfigs(secretConfig());
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
