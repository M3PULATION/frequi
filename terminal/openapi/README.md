# strc-openapi

`strc.kexu.win` 只读实盘 API 的旁路聚合 Worker，部署在独立域名 **`strc-openapi.kexu.win`**。

它不做任何写操作，也不保存凭据：每次请求都通过普通 `fetch` 调用 `https://strc.kexu.win` 的公开只读端点，并用 `x-ft-bot` 请求头指定实盘实例。

## 为什么是旁路

`strc.kexu.win` 整个 hostname 已被 Worker `frequi-terminal` 的 custom domain 独占。custom domain 接管的是完整主机名，不能再在同一个 hostname 上挂 zone route 去接管某个子路径，所以新增的聚合入口无法直接加在 `strc.kexu.win` 下。

旁路方案：

- `frequi-terminal` 保持不动，继续在 `strc.kexu.win` 提供 `/api/*`、`/local/*`、`/healthz`、`/openapi.json`。
- 新 Worker `strc-openapi` 拥有自己的 hostname `strc-openapi.kexu.win`，反向调用上述公开只读端点做聚合。

## 接口

| 路径 | 说明 |
| --- | --- |
| `GET /healthz` | 健康检查，`{"ok":true}` |
| `GET /local/bots` | 全部实盘列表（转发上游 `/local/bots`） |
| `GET /local/overview` | 聚合快照：`{ generatedAt, bots }`，每台在线实盘附带 `status` / `profit` / `balance` |
| `GET /local/bots/:id/status` | 单实盘开放仓位，映射上游 `/api/v1/status` |
| `GET /local/bots/:id/balance` | 单实盘余额，映射上游 `/api/v1/balance` |
| `GET /local/bots/:id/profit` | 单实盘收益汇总，映射上游 `/api/v1/profit` |
| `GET /local/bots/:id/trades` | 单实盘成交记录，映射上游 `/api/v1/trades`；`?limit=` 等查询参数原样透传 |
| `GET /openapi.json` | OpenAPI 3.1 描述 |
| `GET /local/doc` | 中文 HTML 文档页 |

容错与超时：

- `/local/overview` 先拉 `/local/bots`，再对每个 **online** 实盘并发拉取 `status` / `profit` / `balance`；每个字段单独 `.catch(() => null)`，离线实盘三个字段直接为 `null`。
- 上游超时：列表 8s、overview 单字段 5s、单实盘转发 10s。
- 所有响应带 `Cache-Control: no-store`；顶层异常返回 `500` JSON，未知路径返回 `404 {"detail":"未找到"}`。
- 未知实盘 id 由上游 `/api/*` 返回 `400 {"detail":"未知实盘"}`，本 Worker 原样透传。

## 部署

```sh
cd terminal/openapi
npx wrangler deploy
```

也可以在 `terminal/` 目录下用 `--config` 指定配置：

```sh
cd terminal
npx wrangler deploy --config openapi/wrangler.jsonc
```

首次使用前先安装依赖（仅本目录）：

```sh
npm install        # 或 pnpm install
```

只校验构建与配置、不真正发布：

```sh
cd terminal
npx wrangler deploy --dry-run --config openapi/wrangler.jsonc
```

本地调试：

```sh
npx wrangler dev
```

`wrangler.jsonc` 通过 zone-level Workers route（`routes: [{ "pattern": "strc-openapi.kexu.win/*", "zone_name": "kexu.win" }]`）绑定这个 hostname，部署需要 `kexu.win` zone 的 Workers Routes 权限。线上实际接入方式就是这条 zone route 指向 Worker `strc-openapi`，配合下文 DNS 中的 proxied AAAA 记录生效，**不是 custom domain**。

## DNS

`strc-openapi.kexu.win` 已在 Cloudflare DNS 中创建 **AAAA 记录指向 `100::`，并开启代理（proxied / 橙色云）**。`100::` 是 IPv6 的 discard 前缀，仅作为占位；开启代理后实际流量进入 Cloudflare 边缘，由 Worker 处理，不会真的连到这个地址。

这条 proxied AAAA 记录是 zone route 生效的前提：记录把 `strc-openapi.kexu.win` 的流量送进 Cloudflare 边缘，route 再把它交给本 Worker。`strc-openapi.kexu.win` 是独立 hostname，与 `strc.kexu.win` 上 `frequi-terminal` 的 custom domain 互不影响。

这里没有用 `custom_domain`：wrangler 会拒绝 custom domain 里的路径与通配符（`Paths are not allowed in Custom Domains` / `Wildcard operators (*) are not allowed in Custom Domains`），而 `strc-openapi.kexu.win/*` 这种按 hostname 收流的写法正是 zone route 的用法。

## 部署形态约束

Cloudflare 的 multipart 上传路径要求这个 Worker 使用 **service-worker 语法**（`addEventListener('fetch', ...)`），不要改成 `export default` 的 ES module 形式：使用 `main_module` + `export default` 会报 `Missing entry-point file`，改用 `body_part: script` + service-worker 形式才能成功。

## 与主 Worker 的关系

本目录是独立 Worker，不参与 `terminal/` 前端的 Vite/TypeScript 构建：

- 没有改 `terminal/worker/core.ts` 等现有代码。
- 没有引入根目录依赖；依赖与脚本只存在于本目录的 `package.json`。
- `pnpm-workspace.yaml` 的包列表只有 `terminal`，本目录不会被当作 workspace 包。
