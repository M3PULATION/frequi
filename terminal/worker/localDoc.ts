/**
 * Self-contained HTML for the public read-only API guide. Build-free like
 * adminPage.ts: it is served straight from the worker and contains no config or
 * credentials, so it can stay public.
 */
export function localDocHtml(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>只读接口文档 · strc.kexu.win</title>
<link rel="icon" type="image/png" href="/logo.png">
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
  <p>本页列出 <code>strc.kexu.win</code> 暴露的只读接口。全部接口无需认证，直接使用普通 GET 请求即可；响应均带 <code>Cache-Control: no-store</code>。数据来自各实盘 freqtrade 实例的实时聚合。</p>

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
curl -s https://strc.kexu.win/local/bots

# 聚合快照（一次拿到所有实盘的 status / profit / balance）
curl -s https://strc.kexu.win/local/overview

# 单实盘（id 从 /local/bots 获取，例如 us-vxtrans-com-2894）
curl -s https://strc.kexu.win/local/bots/us-vxtrans-com-2894/status
curl -s https://strc.kexu.win/local/bots/us-vxtrans-com-2894/balance
curl -s https://strc.kexu.win/local/bots/us-vxtrans-com-2894/profit
curl -s "https://strc.kexu.win/local/bots/us-vxtrans-com-2894/trades?limit=20"</code></pre>

  <h2>说明</h2>
  <div class="note">
    <p>未知的实盘 id 返回 <code>404</code> 与 <code>{"detail":"未知实盘"}</code>；上游不可达返回 <code>502</code> 与 <code>{"detail":...}</code>。</p>
    <p><code>/local/overview</code> 中每个实盘的 <code>status</code>、<code>profit</code>、<code>balance</code> 独立容错：某台实例离线、超时或缺少某个接口时，仅该字段为 <code>null</code>，其余实盘照常返回。上游单次请求约 5 秒超时。</p>
    <p>完整的机器可读定义见 <a href="/openapi.json">/openapi.json</a>。</p>
  </div>
</main>
</body>
</html>`;
}
