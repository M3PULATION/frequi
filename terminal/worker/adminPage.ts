/**
 * Self-contained HTML for the private config page. Deliberately build-free: it
 * is not part of the Vite bundle, so the investor-facing terminal never ships
 * this code.
 *
 * `base` is the path the worker serves the page from; it is injected into the
 * page script rather than hardcoded here, so moving the page only requires
 * changing the deployer's ADMIN_PATH var (and the matching static assets
 * routing in wrangler.jsonc).
 *
 * Styling mirrors the main site (src/index.css): the same dark palette, the
 * mint `--primary` accent, the Schibsted Grotesk brand face for headings, and
 * the same 0.75rem radius. Kept as plain CSS so the page needs no build step.
 */
export function adminPageHtml(base: string): string {
  const apiUrl = JSON.stringify(`${base}/api/config`);
  return String.raw`<!doctype html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>实盘配置管理 · MANIPULATION</title>
<link rel="icon" type="image/png" href="/logo.png">
<style>
  @font-face {
    font-family: 'Inter Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 100 900;
    src: url(https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZs.woff2) format('woff2');
  }
  @font-face {
    font-family: 'Schibsted Grotesk Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 400 900;
    src: url(https://fonts.gstatic.com/s/schibstedgrotesk/v6/JqzK5SSPQuCKMX_LbGv0z2W8lSbFzWtLZ8BjcA.woff2) format('woff2');
  }

  /* Tokens copied from src/index.css so the page reads as the same product. */
  :root {
    --background: #04060c;
    --foreground: rgba(255, 255, 255, 0.92);
    --card: #0a0d16;
    --popover: #121622;
    --primary: #97fce4;
    --primary-foreground: #04060c;
    --secondary: #121622;
    --muted-foreground: rgba(255, 255, 255, 0.55);
    --accent: rgba(151, 252, 228, 0.12);
    --destructive: #ff5470;
    --up: #3fd68b;
    --border: rgba(255, 255, 255, 0.08);
    --input: rgba(255, 255, 255, 0.1);
    --ring: rgba(151, 252, 228, 0.55);
    --radius: 0.75rem;
    --font-sans: 'Inter Variable', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    --font-brand: 'Schibsted Grotesk Variable', 'Inter Variable', sans-serif;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* A soft mint wash behind the content, like the main shell. */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(60rem 30rem at 15% -10%, rgba(151, 252, 228, 0.07), transparent 60%),
      radial-gradient(40rem 24rem at 90% 0%, rgba(80, 210, 193, 0.05), transparent 60%);
  }

  main {
    position: relative;
    width: min(1040px, calc(100% - 48px));
    margin: 0 auto;
    padding: 56px 0 96px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 34px;
  }
  .brand img { width: 28px; height: 28px; object-fit: contain; }
  .brand span {
    font-family: var(--font-brand);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.72);
  }

  header.page-head { margin-bottom: 28px; }
  .eyebrow {
    display: inline-block;
    margin-bottom: 12px;
    padding: 3px 10px;
    border: 1px solid rgba(151, 252, 228, 0.25);
    border-radius: 999px;
    background: var(--accent);
    color: var(--primary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0 0 10px;
    font-family: var(--font-brand);
    font-size: clamp(26px, 3.4vw, 36px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .lede { margin: 0; max-width: 62ch; color: var(--muted-foreground); font-size: 14px; }

  .card {
    margin-top: 20px;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
  }
  .card[hidden] { display: none; }

  h2 {
    margin: 0 0 6px;
    font-family: var(--font-brand);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .hint { margin: 0 0 16px; color: var(--muted-foreground); font-size: 13px; }

  .auth-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .auth-row input { flex: 1 1 260px; }

  input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--input);
    border-radius: calc(var(--radius) - 2px);
    background: rgba(0, 0, 0, 0.35);
    color: var(--foreground);
    font-family: inherit;
    font-size: 13px;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  input::placeholder { color: rgba(255, 255, 255, 0.32); }
  input:focus {
    outline: none;
    border-color: rgba(151, 252, 228, 0.6);
    box-shadow: 0 0 0 3px rgba(151, 252, 228, 0.13);
  }

  button {
    padding: 9px 18px;
    border: 1px solid transparent;
    border-radius: calc(var(--radius) - 2px);
    background: var(--primary);
    color: var(--primary-foreground);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
  }
  button:hover:not(:disabled) { opacity: 0.9; }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }

  button.ghost {
    background: transparent;
    border-color: var(--border);
    color: rgba(255, 255, 255, 0.78);
  }
  button.ghost:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.16);
  }
  button.ghost.danger { color: var(--destructive); }
  button.ghost.danger:hover:not(:disabled) {
    background: rgba(255, 84, 112, 0.1);
    border-color: rgba(255, 84, 112, 0.3);
  }

  .row {
    display: grid;
    grid-template-columns: 1.1fr 1.5fr 0.9fr 1fr auto;
    gap: 12px;
    align-items: end;
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
  }
  .row:first-child { padding-top: 4px; }
  .row:last-child { border-bottom: none; }
  .row-actions { display: flex; align-items: end; padding-bottom: 1px; }

  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field > span {
    color: var(--muted-foreground);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .toolbar { display: flex; gap: 10px; align-items: center; margin-top: 20px; }
  .toolbar .spacer { flex: 1; }

  .message { min-height: 20px; margin: 12px 0 0; color: var(--muted-foreground); font-size: 13px; }
  .message.ok { color: var(--up); }
  .message.error { color: var(--destructive); }

  #source { margin: 0 0 6px; color: var(--muted-foreground); font-size: 13px; }

  @media (max-width: 860px) {
    main { width: calc(100% - 32px); padding-top: 36px; }
    .row { grid-template-columns: 1fr 1fr; gap: 10px; }
    .row-actions { grid-column: 2; justify-content: end; }
    .card { padding: 18px; }
  }
</style>
</head>
<body>
<main>
  <div class="brand">
    <img src="/logo.png" alt="">
    <span>Manipulation</span>
  </div>

  <header class="page-head">
    <span class="eyebrow">只读终端 · 管理</span>
    <h1>实盘配置管理</h1>
    <p class="lede">在这里维护机器人连接信息。密码只保存在服务端，保存后即写入 KV 并立即生效。</p>
  </header>

  <section id="auth" class="card" hidden>
    <h2>输入管理令牌</h2>
    <p class="hint">令牌保存在本机浏览器中，仅用于调用管理接口。</p>
    <div class="auth-row">
      <input id="token" type="password" placeholder="管理令牌" autocomplete="current-password">
      <button id="token-save" type="button">进入</button>
    </div>
    <p id="auth-message" class="message error"></p>
  </section>

  <section id="editor" class="card" hidden>
    <h2>机器人</h2>
    <p id="source"></p>
    <div id="rows"></div>
    <div class="toolbar">
      <button id="add" class="ghost" type="button">添加实盘</button>
      <span class="spacer"></span>
      <button id="save" type="button">保存配置</button>
    </div>
    <p id="message" class="message"></p>
  </section>
</main>
<script>
(function () {
  'use strict';
  var TOKEN_KEY = 'frequi-terminal-admin-token';
  var API_URL = __ADMIN_API_URL__;
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var authEl = document.getElementById('auth');
  var editorEl = document.getElementById('editor');
  var tokenInput = document.getElementById('token');
  var authMessage = document.getElementById('auth-message');
  var rowsEl = document.getElementById('rows');
  var sourceEl = document.getElementById('source');
  var messageEl = document.getElementById('message');
  var saveBtn = document.getElementById('save');

  function setMessage(text, kind) {
    messageEl.textContent = text || '';
    messageEl.className = kind ? 'message ' + kind : 'message';
  }

  function showAuth(text) {
    authEl.hidden = false;
    editorEl.hidden = true;
    authMessage.textContent = text || '';
    tokenInput.value = '';
    tokenInput.focus();
  }

  function showEditor() {
    authEl.hidden = true;
    editorEl.hidden = false;
  }

  function requestConfig(options) {
    var init = options || {};
    var headers = { Authorization: 'Bearer ' + token };
    if (init.body) headers['Content-Type'] = 'application/json';
    return fetch(API_URL, {
      method: init.method || 'GET',
      headers: headers,
      body: init.body
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.detail || ('请求失败，状态码 ' + response.status));
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function field(labelText, fieldName, type, placeholder) {
    var label = document.createElement('label');
    var span = document.createElement('span');
    span.textContent = labelText;
    var input = document.createElement('input');
    input.type = type;
    input.dataset.field = fieldName;
    input.placeholder = placeholder;
    input.autocomplete = fieldName === 'password' ? 'new-password' : 'off';
    label.className = 'field';
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  function addRow(bot, isNew) {
    var row = document.createElement('div');
    row.className = 'row';
    row.appendChild(field('名称', 'name', 'text', '策略名称'));
    row.appendChild(field('地址', 'url', 'text', 'http://host:8080'));
    row.appendChild(field('用户名', 'username', 'text', 'freqtrader'));
    row.appendChild(field('密码', 'password', 'password', isNew ? '必填' : '留空则不修改'));

    var actions = document.createElement('div');
    actions.className = 'row-actions';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost danger';
    remove.textContent = '删除';
    remove.addEventListener('click', function () {
      row.remove();
      if (!rowsEl.children.length) addRow(null, true);
    });
    actions.appendChild(remove);
    row.appendChild(actions);

    if (bot) {
      row.querySelector('[data-field="name"]').value = bot.name || '';
      row.querySelector('[data-field="url"]').value = bot.url || '';
      row.querySelector('[data-field="username"]').value = bot.username || '';
    }
    rowsEl.appendChild(row);
  }

  function render(bots, source) {
    rowsEl.textContent = '';
    (bots || []).forEach(function (bot) { addRow(bot, false); });
    if (!rowsEl.children.length) addRow(null, true);
    if (source === 'kv') {
      sourceEl.textContent = '当前配置来自 KV，保存后立即生效。';
    } else {
      sourceEl.textContent = '当前还没有配置任何实盘，请在下方添加。';
    }
  }

  function load(successText) {
    if (!token) { showAuth(''); return Promise.resolve(); }
    setMessage('正在读取配置…', '');
    return requestConfig().then(function (data) {
      render(data.bots, data.source);
      showEditor();
      setMessage(successText || '', successText ? 'ok' : '');
    }).catch(function (error) {
      if (error.status === 401) {
        token = '';
        localStorage.removeItem(TOKEN_KEY);
        showAuth('令牌无效，请重新输入。');
        return;
      }
      if (error.status === 503) { showAuth(error.message); return; }
      setMessage(error.message, 'error');
    });
  }

  function collect() {
    var bots = [];
    Array.prototype.forEach.call(rowsEl.querySelectorAll('.row'), function (row) {
      function value(name) {
        var input = row.querySelector('[data-field="' + name + '"]');
        return input ? input.value : '';
      }
      var password = value('password');
      bots.push({
        name: value('name').trim(),
        url: value('url').trim(),
        username: value('username'),
        password: password ? password : null
      });
    });
    return bots;
  }

  function submitToken() {
    var value = tokenInput.value.trim();
    if (!value) { authMessage.textContent = '请输入管理令牌。'; return; }
    token = value;
    localStorage.setItem(TOKEN_KEY, value);
    authMessage.textContent = '';
    load();
  }

  document.getElementById('token-save').addEventListener('click', submitToken);
  tokenInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') submitToken();
  });
  document.getElementById('add').addEventListener('click', function () { addRow(null, true); });

  saveBtn.addEventListener('click', function () {
    if (!token) { showAuth('请先输入管理令牌。'); return; }
    saveBtn.disabled = true;
    setMessage('正在保存…', '');
    requestConfig({
      method: 'PUT',
      body: JSON.stringify({ bots: collect() })
    }).then(function () {
      return load('已保存。');
    }).catch(function (error) {
      if (error.status === 401) {
        token = '';
        localStorage.removeItem(TOKEN_KEY);
        showAuth('令牌无效，请重新输入。');
        return;
      }
      setMessage(error.message, 'error');
    }).then(function () {
      saveBtn.disabled = false;
    });
  });

  if (token) load(); else showAuth('');
})();
</script>
</body>
</html>`.replace('__ADMIN_API_URL__', () => apiUrl);
}