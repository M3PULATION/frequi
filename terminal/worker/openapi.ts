/**
 * Static OpenAPI 3.1 description of the worker's read-only HTTP surface.
 *
 * Kept as a plain constant (no codegen, no runtime reflection) so the worker
 * can serve it directly. Update it together with `route()` in core.ts.
 */

const errorDetail = { $ref: '#/components/schemas/ErrorDetail' } as const;

export const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'strc.kexu.win 只读实盘 API',
    version: '1.0.0',
    description:
      '只读实盘终端的 HTTP 接口。全部接口为公开只读（GET/HEAD），响应不缓存（Cache-Control: no-store）。' +
      '聚合接口会并发访问各实盘实例，单个实例或单个上游接口失败只会把对应字段置为 null，不影响其他数据。',
  },
  servers: [{ url: 'https://strc.kexu.win', description: '生产环境' }],
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
          '并发探测每台实盘。不可达的实例仍会返回，online 为 false；若曾经读取成功过，strategy 与 botName 会保留到宽限期结束。',
        responses: {
          '200': {
            description: '实盘列表',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ListedBot' } },
              },
            },
          },
          '400': {
            description: '尚未配置实盘或配置格式无效',
            content: { 'application/json': { schema: errorDetail } },
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
          '在实盘列表的基础上，并发拉取每台实盘的 status、profit、balance。每个字段独立容错：失败或实例离线时为 null。每个上游请求约 5 秒超时。',
        responses: {
          '200': {
            description: '聚合快照',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Overview' } },
            },
          },
          '400': {
            description: '尚未配置实盘或配置格式无效',
            content: { 'application/json': { schema: errorDetail } },
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
          '404': {
            description: '未知实盘 id',
            content: { 'application/json': { schema: errorDetail } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: errorDetail } },
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
          '404': {
            description: '未知实盘 id（上游 404 也会原样透传）',
            content: { 'application/json': { schema: errorDetail } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: errorDetail } },
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
          '404': {
            description: '未知实盘 id',
            content: { 'application/json': { schema: errorDetail } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: errorDetail } },
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
          '404': {
            description: '未知实盘 id',
            content: { 'application/json': { schema: errorDetail } },
          },
          '502': {
            description: '实盘不可达',
            content: { 'application/json': { schema: errorDetail } },
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
} as const;
