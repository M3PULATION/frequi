# 实盘操作台

只读的 Freqtrade 实盘面板。账号写在服务器上的配置文件里，浏览器不能下单。

## 本地开发

复制 `terminal/bots.example.json` 为 `terminal/bots.local.json`，填入实盘地址和密码。这个文件不会进入 git。

```bash
corepack pnpm install
corepack pnpm --filter frequi-terminal dev
```

打开 http://127.0.0.1:3001/ 。

## Docker

镜像提供静态页面，并用同一进程转发只读 API。密码通过挂载的配置进入容器，不会打进镜像。

```bash
docker compose up --build
```

页面在 http://127.0.0.1:3001/ 。配置文件是 `terminal/bots.local.json`。
