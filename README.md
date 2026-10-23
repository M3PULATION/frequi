# 实盘操作台

[![CI](https://github.com/M3PULATION/frequi/actions/workflows/ci.yml/badge.svg)](https://github.com/M3PULATION/frequi/actions/workflows/ci.yml)

只读的 Freqtrade 实盘终端,给需要向投资人、朋友或第三方展示实盘的人使用。浏览器只能看:所有写操作都在 Worker 层被拒绝,机器人凭据只保存在服务端。

本项目运行在 Cloudflare Workers 上:Worker 负责认证、会话与只读转发,Workers Assets 提供前端,机器人与管理令牌存在 KV 与 Worker Secret 中。

> 本项目 fork 自 [FreqUI](https://github.com/freqtrade/freqUI),但当前分支是与上游完全不同的独立实现。详见[项目来源与许可](#项目来源与许可)。

## 特性

- **只读白名单**:只放行 `GET` / `HEAD`,以及查询 K 线所需的 `POST /api/v1/pair_candles`、`POST /api/v1/pair_history`;其余请求返回 `403 {"detail":"这个面板只读"}`。
- **凭据不出浏览器**:Freqtrade 的地址、用户名、密码由 Worker 持有;管理接口返回的密码字段永远为 `null`。
- **KV 配置**:机器人列表存在 KV 的 `bots` key,保存后由 Worker 读取,无需重新部署。
- **网页管理**:配置页支持增删机器人、留空沿用原密码,保存即写入 KV;入口路径由部署者通过 `ADMIN_PATH` 自定义(默认 `/admin`)。
- **多机器人**:同一面板可展示多台实盘,顶部切换,首页汇总在线状态、策略与权益。
- **策略与行情页面**:实盘概览、持仓、历史成交、K 线、盈亏、余额、交易对、日志、系统信息。
- **无 Node 运行时**:Worker 只使用标准 Web API,生产环境不需要容器或常驻进程。

## 页面

| 路径 | 内容 |
| --- | --- |
| `/bots` | 多机器人概览、在线状态、策略、权益与收益曲线 |
| `/positions` | 当前持仓与未平仓盈亏 |
| `/history` | 已平仓交易历史 |
| `/chart` | K 线与成交标记 |
| `/profit` | 累计盈亏与收益曲线 |
| `/balance` | 账户余额与历史余额 |
| `/pairs` | 交易对列表与表现 |
| `/logs` | Freqtrade 运行日志 |
| `/system` | 系统 / 运行信息 |
| `ADMIN_PATH` | 配置管理页(默认 `/admin`,由 `vars.ADMIN_PATH` 配置,不对外链接) |

## 架构

```text
                          ┌──────────────────────────┐
  浏览器 ──── 静态页面 ───►│ Workers Assets (dist/)   │
     │                    └──────────────────────────┘
     │ /api/*  (X-Ft-Bot)
     │ /local/bots
     │ ADMIN_PATH
     ▼
  ┌───────────────────────────────────────────────┐
  │ Cloudflare Worker (terminal/worker/core.ts)   │
  │  · 只读校验          · 会话 / token 续期       │
  │  · 多机器人目录      · 管理 API + 限流         │
  └───────┬───────────────────────────┬───────────┘
          │                           │
          ▼                           ▼
  KV namespace BOTS_KV          Freqtrade /api/v1
  key: "bots"                   (Basic → Bearer, 只读)
```

- `terminal/worker/index.ts`:Worker 入口,只导出 `fetch`。
- `terminal/worker/core.ts`:路由、KV 读取、管理认证、只读转发与缓存。
- `terminal/worker/adminPage.ts`:自包含的管理页 HTML,不进入前端构建产物。
- `terminal/src/`:React 前端,构建后写入 `terminal/dist`。
- `terminal/wrangler.jsonc`:Worker、Assets 与 KV 绑定。
- 路由分发:`/api/*`、`/local/*`、`/healthz` 以及 `ADMIN_PATH`(默认 `/admin`)下的路径先交给 Worker;其余路径交给 Assets,SPA 回退到 `index.html`。注意 `run_worker_first` 是静态列表,必须与 `ADMIN_PATH` 手动保持一致。

## 部署前置条件

- 一个 Cloudflare 账号(免费版即可)。
- Node.js 20+ 与 pnpm(`corepack enable` 可启用仓库声明的 pnpm 版本)。
- 已通过 `wrangler login` 登录,或设置好 `CLOUDFLARE_API_TOKEN`。

## 部署步骤

以下命令都在 `terminal/` 目录执行。

```bash
cd terminal
corepack enable
pnpm install
pnpm exec wrangler login
```

1. **创建 KV namespace**

   ```bash
   pnpm exec wrangler kv namespace create BOTS_KV
   ```

   命令会输出 namespace 的 `id`。把它填入 `wrangler.jsonc` 的 `kv_namespaces[0].id`;仓库里是占位符 `<your-kv-namespace-id>`,部署前必须换成你自己的,否则 `wrangler deploy` 会因绑定无效而失败。`wrangler dev` 使用本地 KV,占位符不影响启动。

2. **配置管理页路径(可选)**

   `wrangler.jsonc` 的 `vars.ADMIN_PATH` 默认是 `/admin`,开箱即用。建议改成只有你知道的入口,例如 `/my-private-entry`。修改时 `wrangler.jsonc` 里**必须同步改两处**,否则请求到不了 Worker:

   - `vars.ADMIN_PATH`
   - `assets.run_worker_first` 中的两项(裸路径与 `/*` 变体),例如 `["/my-private-entry", "/my-private-entry/*"]`

   `run_worker_first` 是静态配置,无法读取 `vars`,这是已知的成对修改点。使用 Vite 本地开发时,`terminal/vite.config.ts` 的代理也读取 `ADMIN_PATH` 环境变量,请用同一个值启动(见[本地开发](#本地开发))。

3. **构建前端**

   ```bash
   pnpm build
   ```

   构建结果在 `terminal/dist`,Workers Assets 直接读取该目录。

4. **设置管理令牌**

   ```bash
   pnpm exec wrangler secret put ADMIN_TOKEN
   ```

   令牌就是管理页的登录凭据。请使用足够长的随机值,例如 `openssl rand -base64 32`。不要把它写进仓库、`wrangler.jsonc` 或聊天记录。

5. **部署**

   ```bash
   pnpm deploy:worker
   # 等价于 pnpm exec wrangler deploy
   ```

6. **添加机器人**

   打开 `https://<worker-name>.<your-subdomain>.workers.dev<ADMIN_PATH>`,例如默认的 `https://<worker-name>.<your-subdomain>.workers.dev/admin`,或你自定义的 `/my-private-entry`。输入 `ADMIN_TOKEN`,然后填写每台实盘的名称、地址、用户名和密码并保存。

   可选:在 Cloudflare 控制台为 Worker 绑定自有域名,再按同样方式访问管理页。

## 本地开发

本地开发需要两个终端:一个跑 Workers,一个跑 Vite。Vite 会把 `/api`、`/local`、`/healthz` 和 `ADMIN_PATH`(默认 `/admin`)代理到 `127.0.0.1:8787`。若要使用自定义路径,请让 Workers 和 Vite 使用同一个值,并同步 `run_worker_first`:

```bash
# wrangler.jsonc: vars.ADMIN_PATH 与 run_worker_first 都要改成 /my-private-entry
ADMIN_PATH=/my-private-entry pnpm dev                # Vite
pnpm exec wrangler dev --var ADMIN_PATH:/my-private-entry  # Workers
```

```bash
cd terminal
pnpm install
pnpm build          # 首次运行 dev:worker 前需要生成本地 Assets
```

**终端 1:Workers**

```bash
cd terminal
printf 'ADMIN_TOKEN=local-admin-token\n' > .dev.vars   # 不要提交
pnpm dev:worker                                       # http://127.0.0.1:8787
```

**终端 2:Vite**

```bash
cd terminal
pnpm dev                                              # http://127.0.0.1:3001
```

- 前端页面:http://127.0.0.1:3001/
- 管理页:http://127.0.0.1:3001/admin (默认路径,经 Vite 代理;自定义时替换为你的 `ADMIN_PATH`)
- 本地 KV 状态保存在 `terminal/.wrangler/`,`.dev.vars` 和 `.wrangler/` 都不会进入 git。

也可以不带前端、直接验证 Worker:

```bash
pnpm typecheck:worker
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/local/bots
```

`pnpm test` 只跑纯函数与 Worker 单测,不需要任何本地配置文件。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | Vite 开发服务器(3001,代理到 8787) |
| `pnpm dev:worker` | 本地 Workers 运行时(8787) |
| `pnpm build` | 前端类型检查并构建到 `dist/` |
| `pnpm typecheck:worker` | 单独检查 Worker 代码 |
| `pnpm test` | 运行 Vitest |
| `pnpm deploy:worker` | 部署到 Cloudflare |

## 配置与生效时间

- 唯一配置来源是 KV namespace `BOTS_KV` 的 `bots` key,值是 JSON 数组:

  ```json
  [
    {
      "name": "主策略",
      "url": "https://bot.example.com:8080",
      "username": "freqtrader",
      "password": "your-bot-password"
    }
  ]
  ```

- `url` 末尾的 `/dashboard` 与多余斜杠会被归一化;未写协议时按 `http://` 处理。
- 保存后当前 isolate 立即刷新;其他 isolate 最多 **5 秒**后可见。
- 密码不会回填到管理页。地址或用户名变更后,该行必须重新输入密码,避免把旧凭据交给另一台机器。

## 安全模型

请先读这一节,再决定是否把链接发给别人。

- **只读面板本身没有登录**:任何拿到终端 URL 的人都能查看持仓、盈亏与日志。这是面向投资人展示的设计。如果需要限制访问,请在 Cloudflare 侧使用 Access 或 WAF,不要只依赖"路径没人知道"。
- **管理页路径不是安全边界**:`ADMIN_PATH`(默认 `/admin`,部署者可自定义)只决定入口地址,不提供访问控制;页面本身公开且不含配置。真正的边界是 `ADMIN_TOKEN`;所有 `${ADMIN_PATH}/api/*` 请求都必须带 `Authorization: Bearer <token>`。不要因为路径不公开就降低令牌强度。
- **令牌强度决定安全性**:请使用至少 32 字节的随机值。连续失败 10 次后,同一 isolate 内同一 IP 会被限制 5 分钟;限流状态保存在内存中,不是跨节点的强保证。
- **机器人凭据保存在 KV**,由 Worker 在转发时使用;管理接口的响应、错误信息和页面 HTML 都不会包含密码。
- **写入被白名单拦截**:除 `GET`/`HEAD` 与两个 K 线查询 POST 外,所有方法返回 403;POST 请求体上限 64 KiB。
- **免费版额度**:Workers 免费计划每天约 10 万次请求。面板会轮询多个接口,持续开着的页面也会消耗额度;超出后请求失败。需要长期高频查看时请升级计划或减少轮询。
- **管理令牌存在浏览器 `localStorage`**:仅建议在自己的设备上登录管理页;公共电脑使用后请清理站点数据。

## 常见问题

**机器人一直显示"离线"**

Worker 从 Cloudflare 网络发起请求,不能访问你电脑上的 `127.0.0.1`。生产环境请填写机器人公网可达的地址,并确认:

- 地址与端口能从外网访问,最好使用 HTTPS;
- Freqtrade 的 `/api/v1/token/login` 可用;
- 用户名、密码正确;
- 该地址没有被 Cloudflare 或防火墙拦截。

**管理接口返回 401 / 403 / 429**

- `401`:令牌缺失或错误。
- `429`:同一 IP 连续失败 10 次,等待 5 分钟。
- `503` 且提示"未配置管理令牌":还没执行 `wrangler secret put ADMIN_TOKEN`。
- 修改 Secret 后无需重新构建,但需要重新部署或等待新版本生效。

**改了配置不生效**

当前 isolate 会立即生效,其他 isolate 最多缓存 5 秒;刷新页面后仍不对,请确认保存时返回了 `{"ok": true}`,并检查 `wrangler tail` 是否有错误。

**`wrangler dev` 启动后页面 404 或没有样式**

先执行 `pnpm build` 生成 `terminal/dist`。

**改了 `ADMIN_PATH` 后管理页 404,或返回了前端 SPA**

请求在到达 Worker 前被 Assets 接走了。请把 `wrangler.jsonc` 中 `assets.run_worker_first` 的两项(裸路径与 `/*`)改成同一个新路径,然后重新部署。这个列表是静态的,不会读取 `vars.ADMIN_PATH`。

**`wrangler deploy` 报 KV namespace 不存在**

仓库里的 `kv_namespaces[0].id` 是占位符 `<your-kv-namespace-id>`。先执行 `pnpm exec wrangler kv namespace create BOTS_KV`,把输出的真实 id 填进去。`wrangler dev` 使用本地 KV,占位符也能启动;`deploy` 必须使用真实 id。

**`/local/bots` 返回 `[]` 或全部离线**

`[]` 表示 KV 里还没有配置;有记录但 `online:false` 表示 Worker 登录或读取该机器人失败。配置本身仍然有效,修复网络或凭据后会自动恢复。

**能在本地开发里连本机 Freqtrade 吗?**

可以。`wrangler dev` 运行在本机,`http://127.0.0.1:8080` 这类地址在本地开发时可达;部署到 Cloudflare 后则不行。

## 项目来源与许可

本项目 fork 自 [freqtrade/freqUI](https://github.com/freqtrade/freqUI)。

`feat/readonly-terminal` 及其衍生分支(包括当前分支)是与上游完全不同的独立实现:只读终端、Cloudflare Workers 后端与 KV 配置。这些改动**不向上游提交,也不合并回上游 main**;本项目不声称向官方 FreqUI 贡献了任何内容。

原项目的 GPL-3.0 许可证保留在 [LICENSE](LICENSE),本项目同样以 GPL-3.0 发布。上游项目:https://github.com/freqtrade/freqUI
