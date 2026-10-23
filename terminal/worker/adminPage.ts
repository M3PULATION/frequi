/**
 * Self-contained admin page. Shipped as a string so the Worker has no build
 * step or extra asset rule; it never contains configuration of its own.
 */
export const ADMIN_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>实盘配置管理</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d10;
    --panel: #14181d;
    --panel-soft: #1a1f26;
    --text: #e8eaed;
    --muted: #8b949e;
    --line: #2a3038;
    --accent: #4f8cff;
    --danger: #ff6b6b;
    --ok: #3fb950;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 20% -10%, #17202b 0%, var(--bg) 60%);
    color: var(--text);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  main { width: min(1080px, 100% - 32px); margin: 0 auto; padding: 48px 0 72px; }
  header { margin-bottom: 28px; }
  .eyebrow {
    display: inline-block;
    margin-bottom: 10px;
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: .08em;
  }
  h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.02em; }
  .lede { margin: 0; color: var(--muted); }
  .card {
    margin-top: 20px;
    padding: 22px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .card h2 { margin: 0 0 6px; font-size: 17px; }
  .hint { margin: 0 0 16px; color: var(--muted); font-size: 13px; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field span { color: var(--muted); font-size: 12px; }
  input {
    width: 100%;
    padding: 10px 12px;
    color: var(--text);
    background: #0e1216;
    border: 1px solid var(--line);
    border-radius: 9px;
    font: inherit;
    outline: none;
  }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79, 140, 255, .16); }
  button {
    padding: 10px 16px;
    color: #fff;
    background: var(--accent);
    border: 0;
    border-radius: 9px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  button:disabled { opacity: .55; cursor: default; }
  button.ghost {
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    font-weight: 500;
  }
  button.ghost:hover { color: var(--text); border-color: #3a424d; }
  button.danger:hover { color: var(--danger); border-color: var(--danger); }
  .auth-row { display: flex; gap: 10px; }
  .auth-row input { flex: 1; }
  .row {
    display: grid;
    grid-template-columns: 1.1fr 1.6fr .9fr .9fr auto;
    gap: 12px;
    align-items: end;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .row:first-child { padding-top: 4px; }
  .row-actions { display: flex; align-items: end; padding-bottom: 1px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-top: 18px; }
  .toolbar .spacer { flex: 1; }
  .message { min-height: 22px; margin: 12px 0 0; color: var(--muted); font-size: 13px; }
  .message.ok { color: var(--ok); }
  .message.error { color: var(--danger); }
  #source { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
  @media (max-width: 760px) {
    main { padding-top: 28px; }
    .row { grid-template-columns: 1fr 1fr; }
    .row-actions { grid-column: 2; justify-content: end; }
  }
</style>
</head>
<body>
<main>
  <header>
    <span class="eyebrow">只读终端 · 管理</span>
    <h1>实盘配置管理</h1>
    <p class="lede">在这里修改机器人连接信息。密码只保存在服务端，不会回传到浏览器。</p>
  </header>

  <section id="auth" class="card" hidden>
    <h2>输入管理令牌</h2>
    <p class="hint">令牌保存在本机浏览器中，只用于调用管理接口。</p>
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
    return fetch('/admin/api/config', {
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
    } else if (source === 'secret') {
      sourceEl.textContent = '当前配置来自 Secret(BOTS_CONFIG)。保存后会写入 KV 并优先使用。';
    } else {
      sourceEl.textContent = '当前还没有配置任何实盘。';
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
</html>`;
