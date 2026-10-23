# Cloudflare Workers 部署

`terminal/worker/core.ts` 把只读终端的后端移植成了纯 Web API 的 Worker 逻辑，`terminal/worker/index.ts` 只导出 `fetch` 入口。目录、会话缓存、只读转发、catalog 缓存和 `describeFallback` 宽限逻辑都与 `server/botsProxy.ts` 保持一致。

这条路线与 Docker/Node 路线**并存**：

- Docker：`server/prod.ts` + `server/botsProxy.ts`，配置来自 `bots.local.json` / `BOTS_FILE`。
- Workers：`worker/index.ts`，配置只来自 KV namespace `BOTS_KV`，静态资源来自 Workers Assets(`dist/`)。

两套代码互不依赖，改其中一套不会影响另一套。

## 准备

```bash
cd terminal
pnpm build              # 产物在 terminal/dist,Workers Assets 直接读取
pnpm typecheck:worker   # 单独检查 Worker 代码(使用 @cloudflare/workers-types)
```

## 配置(KV)

Worker 只从 KV namespace `BOTS_KV` 的 `bots` key 读取机器人配置，没有其他配置来源。值是 JSON 数组，每项必须有 `name`、`url`、`username`、`password`，字段与 `bots.example.json` 相同；`url` 末尾的 `/dashboard` 和斜杠会被自动归一化。

配置通过下面的管理页维护，生产环境不要把真实凭据写进仓库或 `wrangler.jsonc`。

## 网页管理配置

在浏览器打开 `/my-private-entry` 即可编辑机器人列表。密码不会下发到浏览器：页面显示为空，留空保存表示沿用原密码。保存后写入 KV 的 `bots` key，本 isolate 会立即刷新缓存；其他 isolate 最多 5 秒后可见。

先设置管理令牌(令牌值由部署方自行决定，不要提交到仓库):

```bash
npx wrangler secret put ADMIN_TOKEN
```

`/my-private-entry` 页面本身可以公开访问(只包含表单，不含任何配置)，但 `/my-private-entry/api/*` 必须携带 `Authorization: Bearer <token>`。同一 isolate 内同一 IP 连续失败 10 次后会被限制 5 分钟。

## 本地体验

本地开发可以用 `.dev.vars`(不要提交)提供管理令牌：

```bash
cat > .dev.vars <<'EOF'
ADMIN_TOKEN=local-admin-token
EOF

pnpm dev:worker          # 默认 http://localhost:8787
curl localhost:8787/healthz
```

机器人配置通过管理页写入本地 KV：打开 `http://localhost:8787/my-private-entry`，输入 `ADMIN_TOKEN` 后添加。也可以直接用 wrangler 写入：

```bash
npx wrangler kv key put --binding BOTS_KV --local bots \
  '[{"name":"演示","url":"http://127.0.0.1:9","username":"freqtrader","password":"change-me"}]'
```

写入后 `curl localhost:8787/local/bots` 应能读到该机器人。没有可达的机器人时，`/local/bots` 仍会返回合法目录，条目为 `online:false`；KV 为空时返回明确提示而不是崩溃。验证完记得删除 `.dev.vars`。

## 部署

```bash
pnpm deploy:worker
```

首次部署前确认已经执行过 `pnpm build`，并且设置了 `ADMIN_TOKEN` Secret、绑定了 `BOTS_KV` namespace。

## 路由与限制

- `/healthz`：`{"ok":true}`，`Cache-Control: no-store`。
- `/local/bots`：实盘目录 JSON，和 Node 版数据形状一致。
- `/api/*`：按 `x-ft-bot` 请求头转发到对应机器人。只允许 `GET`/`HEAD`，以及 `POST /api/v1/pair_candles`、`POST /api/v1/pair_history`；其他方法返回 `403 {"detail":"这个面板只读"}`。
- `/my-private-entry`：私有的配置管理页；`/my-private-entry/api/config` 需要管理令牌。旧路径 `/admin` 不再提供管理页，会像其他未知路径一样交给静态资源/SPA。
- 其余路径交给 Workers Assets，SPA 回退到 `index.html`。
- POST 请求体上限 64 KiB，超限返回 `413 {"detail":"请求体过大"}`。
- 未知或缺失 `x-ft-bot` 返回 `400 {"detail":"未知实盘"}`；上游不可达返回 502。

Worker 只使用标准 Web API，因此 `wrangler.jsonc` 没有启用 `nodejs_compat`。

## 缓存

会话、正在续期的请求、上次探测结果和 catalog 都放在 isolate 的模块级内存里。isolate 被回收后会重新登录，逻辑与 Node 版一致。
