# Contributing

This repository is a fork of [freqtrade/freqUI](https://github.com/freqtrade/freqUI). The read-only terminal maintained here is an independent implementation: **do not open issues or pull requests against the upstream repository for changes in this fork**, and do not try to merge these branches back upstream. Upstream contributions belong in their own project with their own conventions.

## Issues

- Describe what you expected, what happened, and how to reproduce it.
- Include the relevant commit or branch, browser, and deployment target (local `wrangler dev` or Cloudflare).
- Never paste real bot addresses, usernames, passwords, `ADMIN_TOKEN` values, or KV contents. Redact them first.
- Security problems should follow [SECURITY.md](SECURITY.md) instead of a public issue.

## Pull requests

Keep changes small and focused. Before opening a PR:

```bash
cd terminal
pnpm install
pnpm test
pnpm build
pnpm typecheck:worker
```

If you change Worker routing or the admin page, also smoke-test locally with `pnpm dev:worker` and `pnpm dev` (see [README.md](README.md#本地开发)).

## Conventions

- Match the existing code style: TypeScript strict mode, no unused locals or parameters, Chinese UI copy.
- Worker code must stay on standard Web APIs. Do not add `nodejs_compat` or Node-only imports to `terminal/worker/`.
- Configuration comes from KV only. Do not reintroduce file-based config, Docker, or a Node server entry point.
- Add or update tests for pure logic (`terminal/src/**/*.test.ts`). Worker behaviour is tested through `handleRequest` with a fake KV.
- Never commit credentials, `.dev.vars`, local KV state, or bot configuration. Use placeholders in examples.

Commits use short imperative subjects, for example `fix: keep the password when only the name changes`.
