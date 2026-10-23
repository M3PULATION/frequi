/**
 * strc-openapi: read-only aggregation sidecar for strc.kexu.win.
 *
 * Cloudflare requires service-worker syntax here: when the script is uploaded
 * as multipart with `body_part: script`, an `export default` entry point is
 * rejected ("Missing entry-point file"). Keep `addEventListener` + `handle()`
 * and do not convert this file to an ES module worker.
 *
 * The sidecar owns its own hostname (strc-openapi.kexu.win). It never proxies
 * credentials: every request it makes is a public, read-only GET against
 * strc.kexu.win, using the existing `x-ft-bot` header for per-bot routing.
 */

const ORIGIN = 'https://strc.kexu.win';

/** The bot catalog is a probe of every instance, so it gets a little longer. */
const LIST_TIMEOUT_MS = 8_000;
/** One field of one bot in /local/overview. */
const FIELD_TIMEOUT_MS = 5_000;
/** A single-bot request forwarded to the upstream proxy. */
const FORWARD_TIMEOUT_MS = 10_000;

const NO_STORE = { 'Cache-Control': 'no-store' };

const LOCAL_BOT_ROUTE = /^\/local\/bots\/([^/]+)\/(status|balance|profit|trades)$/;
const LOCAL_BOT_UPSTREAM = {
  status: '/api/v1/status',
  balance: '/api/v1/balance',
  profit: '/api/v1/profit',
  trades: '/api/v1/trades',
};

function json(data, status = 200, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE,
      ...headers,
    },
  });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE },
  });
}

/**
 * Fetch one upstream URL with an explicit timeout. `x-ft-bot` is only sent
 * when a bot id is supplied.
 */
async function fetchUpstream(pathname, { botId, search = '', method = 'GET', timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (botId) headers['x-ft-bot'] = botId;
    return await fetch(`${ORIGIN}${pathname}${search}`, {
      method,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Read one JSON endpoint for /local/overview; non-2xx becomes a rejection. */
async function fetchJson(botId, pathname) {
  const upstream = await fetchUpstream(pathname, { botId, timeoutMs: FIELD_TIMEOUT_MS });
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  return upstream.json();
}

/** Forward an upstream response, preserving status and content type. */
async function relay(upstream) {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'no-store');
  // These statuses must not carry a body, even an empty one.
  if (upstream.status === 204 || upstream.status === 205 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers });
  }
  const payload = await upstream.arrayBuffer();
  return new Response(payload, { status: upstream.status, headers });
}

async function listBots() {
  const upstream = await fetchUpstream('/local/bots', { timeoutMs: LIST_TIMEOUT_MS });
  return relay(upstream);
}

/**
 * One aggregate snapshot for every bot.
 *
 * Each field is fetched independently and failures collapse to `null`, so one
 * unreachable or older bot never breaks the response for the others. Offline
 * bots are not probed again: the catalog already told us they are down.
 */
async function overview() {
  const upstream = await fetchUpstream('/local/bots', { timeoutMs: LIST_TIMEOUT_MS });
  if (!upstream.ok) {
    return json({ detail: `上游返回 ${upstream.status}` }, 502);
  }

  const listed = await upstream.json();
  if (!Array.isArray(listed)) {
    return json({ detail: '上游返回格式无效' }, 502);
  }

  const bots = await Promise.all(
    listed.map(async (bot) => {
      const entry = bot && typeof bot === 'object' ? bot : {};
      if (!entry.online) {
        return { ...entry, status: null, profit: null, balance: null };
      }
      const [status, profit, balance] = await Promise.all([
        fetchJson(entry.id, '/api/v1/status').catch(() => null),
        fetchJson(entry.id, '/api/v1/profit').catch(() => null),
        fetchJson(entry.id, '/api/v1/balance').catch(() => null),
      ]);
      return { ...entry, status, profit, balance };
    }),
  );

  return json({ generatedAt: new Date().toISOString(), bots });
}

/** Forward one `/local/bots/:id/:action` request to the matching endpoint. */
async function forwardBot(request, encodedId, action) {
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return json({ detail: '未知实盘' }, 400);
  }

  const url = new URL(request.url);
  // Only the path is remapped; a query string such as ?limit=20 passes through.
  const upstream = await fetchUpstream(LOCAL_BOT_UPSTREAM[action], {
    botId: id,
    search: url.search,
    method: request.method,
    timeoutMs: FORWARD_TIMEOUT_MS,
  });
  return relay(upstream);
}

async function handle(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/healthz') {
      return json({ ok: true });
    }

    if (pathname === '/openapi.json') {
      return json(SPEC);
    }

    if (pathname === '/local/doc') {
      return html(DOC_HTML);
    }

    if (pathname === '/local/bots') {
      return await listBots();
    }

    if (pathname === '/local/overview') {
      return await overview();
    }

    const localBot = LOCAL_BOT_ROUTE.exec(pathname);
    if (localBot) {
      const method = request.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return json({ detail: '方法不支持' }, 405);
      }
      return await forwardBot(request, localBot[1], localBot[2]);
    }

    return json({ detail: '未找到' }, 404);
  } catch (error) {
    return json({ detail: error instanceof Error ? error.message : '无法处理请求' }, 500);
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

/** Static OpenAPI 3.1 description of this sidecar's read-only surface. */
const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'strc-openapi 只读实盘聚合 API',
    version: '1.0.0',
    description:
      'strc.kexu.win 的只读旁路聚合接口。全部接口为公开只读（GET/HEAD），响应不缓存（Cache-Control: no-store）。' +
      '聚合接口会并发访问各实盘实例，单个实例或单个上游接口失败只会把对应字段置为 null，不影响其他数据。',
  },
  servers: [{ url: 'https://strc-openapi.kexu.win', description: '生产环境' }],
  tags: [
    { name: 'local', description: '聚合快照与免请求头的便捷路由' },
    { name: 'meta', description: '健康检查与接口文档' },
  ],
  paths: {
    '/healthz': {
      get: {
        tags: ['meta'],
        operationId: 'healthz',
        summary: '健康检查',
        responses: {
          '200': {
            description: 'Worker 正常运行',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Health' } },
            },
          },
        },
      },
    },
    '/local/bots': {
      get: {
        tags: ['local'],
        operationId: 'listBots',
        summary: '全部实盘列表',
        description:
          '原样转发上游 /local/bots。不可达的实例仍会返回，online 为 false；若曾经读取成功过，strategy 与 botName 会保留到宽限期结束。',
        responses: {
          '200': {
            description: '实盘列表',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ListedBot' } },
              },
            },
          },
          '502': {
            description: '上游不可达',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/overview': {
      get: {
        tags: ['local'],
        operationId: 'overview',
        summary: '全部实盘聚合快照',
        description:
          '在实盘列表的基础上，对每个在线实盘并发拉取 status、profit、balance。每个字段独立容错：失败或实例离线时为 null。上游列表超时 8 秒，单字段超时 5 秒。',
        responses: {
          '200': {
            description: '聚合快照',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Overview' } },
            },
          },
          '502': {
            description: '上游不可达或返回格式无效',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/bots/{id}/status': {
      get: {
        tags: ['local'],
        operationId: 'botStatus',
        summary: '单实盘开放仓位列表',
        description: '免 x-ft-bot 请求头，转发 freqtrade GET /api/v1/status。',
        parameters: [{ $ref: '#/components/parameters/BotId' }],
        responses: {
          '200': {
            description: '开放仓位列表',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BotStatus' } },
            },
          },
          '400': {
            description: '未知实盘 id（由上游返回）',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/bots/{id}/balance': {
      get: {
        tags: ['local'],
        operationId: 'botBalance',
        summary: '单实盘余额',
        description:
          '免 x-ft-bot 请求头，转发 freqtrade GET /api/v1/balance。若实例不支持该接口，会原样返回上游状态（例如 404）。',
        parameters: [{ $ref: '#/components/parameters/BotId' }],
        responses: {
          '200': {
            description: '各币种余额',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BotBalance' } },
            },
          },
          '400': {
            description: '未知实盘 id（由上游返回）',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/bots/{id}/profit': {
      get: {
        tags: ['local'],
        operationId: 'botProfit',
        summary: '单实盘收益汇总',
        description: '免 x-ft-bot 请求头，转发 freqtrade GET /api/v1/profit。',
        parameters: [{ $ref: '#/components/parameters/BotId' }],
        responses: {
          '200': {
            description: '收益汇总',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BotProfit' } },
            },
          },
          '400': {
            description: '未知实盘 id（由上游返回）',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/bots/{id}/trades': {
      get: {
        tags: ['local'],
        operationId: 'botTrades',
        summary: '单实盘成交记录',
        description:
          '免 x-ft-bot 请求头，转发 freqtrade GET /api/v1/trades。查询参数（例如 limit、offset）原样透传。',
        parameters: [
          { $ref: '#/components/parameters/BotId' },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: '返回条数，原样透传给 freqtrade',
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          '200': {
            description: '成交记录',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TradesResponse' } },
            },
          },
          '400': {
            description: '未知实盘 id（由上游返回）',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDetail' } } },
          },
        },
      },
    },
    '/local/doc': {
      get: {
        tags: ['meta'],
        operationId: 'localDoc',
        summary: '接口文档页',
        responses: {
          '200': {
            description: '中文 HTML 文档，包含 curl 示例与 OpenAPI 链接',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['meta'],
        operationId: 'openapi',
        summary: '本 OpenAPI 文档',
        responses: {
          '200': {
            description: 'OpenAPI 3.1 JSON',
            content: {
              'application/json': { schema: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      BotId: {
        name: 'id',
        in: 'path',
        required: true,
        description: '实盘 id，由 origin 生成（例如 us-vxtrans-com-2894），可从 GET /local/bots 获取',
        schema: { type: 'string' },
      },
    },
    schemas: {
      Health: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean', const: true } },
      },
      ErrorDetail: {
        type: 'object',
        required: ['detail'],
        properties: { detail: { type: 'string' } },
      },
      ListedBot: {
        type: 'object',
        required: ['id', 'name', 'strategy', 'botName', 'host', 'online'],
        properties: {
          id: { type: 'string', description: '由 origin 生成的稳定 id' },
          name: { type: 'string', description: '管理页中配置的显示名' },
          strategy: { type: 'string', description: 'freqtrade 当前策略；从未读取成功时为空字符串' },
          botName: { type: 'string', description: 'freqtrade bot_name；未读取过时为空字符串' },
          host: { type: 'string', description: '上游主机与端口' },
          online: { type: 'boolean', description: '本次探测是否成功' },
        },
      },
      Trade: {
        type: 'object',
        description: 'freqtrade Trade 对象，此处只列出常用字段，其余字段原样返回',
        additionalProperties: true,
        properties: {
          trade_id: { type: 'integer' },
          pair: { type: 'string' },
          is_open: { type: 'boolean' },
          open_date: { type: 'string' },
          close_date: { type: ['string', 'null'] },
          amount: { type: 'number' },
          open_rate: { type: 'number' },
          close_rate: { type: ['number', 'null'] },
          current_rate: { type: 'number' },
          profit_abs: { type: ['number', 'null'] },
          profit_ratio: { type: ['number', 'null'] },
        },
      },
      BotStatus: {
        type: ['array', 'null'],
        description: '开放仓位列表；实盘离线或上游失败时为 null（单实盘路由仍原样返回上游响应）',
        items: { $ref: '#/components/schemas/Trade' },
      },
      BalanceEntry: {
        type: 'object',
        description: 'freqtrade 余额条目，其余字段原样返回',
        additionalProperties: true,
        properties: {
          currency: { type: 'string' },
          free: { type: 'number' },
          balance: { type: 'number' },
          used: { type: 'number' },
          est_stake: { type: 'number' },
          stake: { type: 'string' },
          side: { type: 'string' },
        },
      },
      BotBalance: {
        type: ['array', 'null'],
        description: '各币种余额；实盘离线、上游失败或实例不支持 /api/v1/balance 时为 null',
        items: { $ref: '#/components/schemas/BalanceEntry' },
      },
      BotProfit: {
        type: ['object', 'null'],
        description: 'freqtrade /api/v1/profit 的汇总对象；实盘离线或上游失败时为 null',
        additionalProperties: true,
        properties: {
          profit_closed_coin: { type: 'number' },
          profit_closed_percent: { type: 'number' },
          profit_all_coin: { type: 'number' },
          profit_all_percent: { type: 'number' },
          trade_count: { type: 'integer' },
          closed_trade_count: { type: 'integer' },
          winning_trades: { type: 'integer' },
          losing_trades: { type: 'integer' },
          best_pair: { type: 'string' },
          best_rate: { type: 'number' },
        },
      },
      TradesResponse: {
        type: 'object',
        required: ['trades', 'trades_count'],
        description: 'freqtrade /api/v1/trades 的分页响应',
        additionalProperties: true,
        properties: {
          trades: { type: 'array', items: { $ref: '#/components/schemas/Trade' } },
          trades_count: { type: 'integer' },
          offset: { type: 'integer' },
          total_trades: { type: 'integer' },
        },
      },
      OverviewBot: {
        type: 'object',
        required: ['id', 'name', 'strategy', 'botName', 'host', 'online', 'status', 'profit', 'balance'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          strategy: { type: 'string' },
          botName: { type: 'string' },
          host: { type: 'string' },
          online: { type: 'boolean' },
          status: { $ref: '#/components/schemas/BotStatus' },
          profit: { $ref: '#/components/schemas/BotProfit' },
          balance: { $ref: '#/components/schemas/BotBalance' },
        },
      },
      Overview: {
        type: 'object',
        required: ['generatedAt', 'bots'],
        properties: {
          generatedAt: { type: 'string', format: 'date-time', description: '响应生成时间（ISO 8601）' },
          bots: { type: 'array', items: { $ref: '#/components/schemas/OverviewBot' } },
        },
      },
    },
  },
};

/** Self-contained HTML guide. No scripts, no config, no credentials. */
const DOC_HTML = String.raw`<!doctype html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>只读接口文档 · strc-openapi.kexu.win</title>
<style>
  :root {
    --background: #04060c;
    --foreground: rgba(255, 255, 255, 0.92);
    --card: #0a0d16;
    --primary: #97fce4;
    --muted: rgba(255, 255, 255, 0.55);
    --border: rgba(255, 255, 255, 0.08);
    --radius: 0.75rem;
    --font-sans: 'Inter Variable', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 48px 24px 64px;
  }

  h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 36px 0 12px; color: var(--primary); }
  p { margin: 0 0 12px; color: var(--muted); }
  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .badge {
    display: inline-block;
    margin-bottom: 20px;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--primary);
    font-size: 12px;
  }

  table { width: 100%; border-collapse: collapse; }

  th, td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  th { color: var(--muted); font-weight: 500; font-size: 12px; }

  code {
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--card);
    border: 1px solid var(--border);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    word-break: break-all;
  }

  pre {
    margin: 0 0 12px;
    padding: 16px;
    overflow-x: auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    line-height: 1.5;
  }

  pre code { padding: 0; border: 0; background: none; }

  .note {
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    color: var(--muted);
  }
</style>
</head>
<body>
<main>
  <span class="badge">只读 · GET/HEAD · no-store</span>
  <h1>只读接口文档</h1>
  <p>本页列出 <code>strc-openapi.kexu.win</code> 暴露的只读聚合接口。它反向调用 <code>strc.kexu.win</code> 的公开只读端点，把多台实盘的数据聚合到同一个域名下。全部接口无需认证，直接使用普通 GET 请求即可；响应均带 <code>Cache-Control: no-store</code>。</p>

  <h2>接口清单</h2>
  <table>
    <thead>
      <tr><th>路径</th><th>说明</th></tr>
    </thead>
    <tbody>
      <tr><td><code>GET /healthz</code></td><td>健康检查，返回 <code>{"ok":true}</code>。</td></tr>
      <tr><td><code>GET /local/bots</code></td><td>全部实盘列表（id、名称、策略、主机、在线状态）。</td></tr>
      <tr><td><code>GET /local/overview</code></td><td>全部实盘的聚合快照：在列表字段之外并发附带 <code>status</code>、<code>profit</code>、<code>balance</code>；单项失败为 <code>null</code>。</td></tr>
      <tr><td><code>GET /local/bots/&lt;id&gt;/status</code></td><td>单实盘开放仓位列表，对应 freqtrade <code>/api/v1/status</code>。</td></tr>
      <tr><td><code>GET /local/bots/&lt;id&gt;/balance</code></td><td>单实盘余额，对应 freqtrade <code>/api/v1/balance</code>。</td></tr>
      <tr><td><code>GET /local/bots/&lt;id&gt;/profit</code></td><td>单实盘收益汇总，对应 freqtrade <code>/api/v1/profit</code>。</td></tr>
      <tr><td><code>GET /local/bots/&lt;id&gt;/trades</code></td><td>单实盘成交记录，对应 freqtrade <code>/api/v1/trades</code>；<code>?limit=</code> 等查询参数原样透传。</td></tr>
      <tr><td><code>GET /openapi.json</code></td><td>本 API 的 OpenAPI 3.1 描述。</td></tr>
      <tr><td><code>GET /local/doc</code></td><td>本页面。</td></tr>
    </tbody>
  </table>

  <h2>curl 示例</h2>
  <pre><code># 全部实盘
curl -s https://strc-openapi.kexu.win/local/bots

# 聚合快照（一次拿到所有实盘的 status / profit / balance）
curl -s https://strc-openapi.kexu.win/local/overview

# 单实盘（id 从 /local/bots 获取，例如 us-vxtrans-com-2894）
curl -s https://strc-openapi.kexu.win/local/bots/us-vxtrans-com-2894/status
curl -s https://strc-openapi.kexu.win/local/bots/us-vxtrans-com-2894/balance
curl -s https://strc-openapi.kexu.win/local/bots/us-vxtrans-com-2894/profit
curl -s "https://strc-openapi.kexu.win/local/bots/us-vxtrans-com-2894/trades?limit=20"</code></pre>

  <h2>说明</h2>
  <div class="note">
    <p>未知的实盘 id 由上游返回 <code>400</code> 与 <code>{"detail":"未知实盘"}</code>；上游不可达返回 <code>502</code> 与 <code>{"detail":...}</code>；未知路径返回 <code>404</code> 与 <code>{"detail":"未找到"}</code>。</p>
    <p><code>/local/overview</code> 中每个实盘的 <code>status</code>、<code>profit</code>、<code>balance</code> 独立容错：某台实例离线、超时或缺少某个接口时，仅该字段为 <code>null</code>，其余实盘照常返回。单字段上游约 5 秒超时，列表约 8 秒超时。</p>
    <p>完整的机器可读定义见 <a href="/openapi.json">/openapi.json</a>。</p>
  </div>
</main>
</body>
</html>`;
