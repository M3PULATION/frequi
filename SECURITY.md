# Security Policy

This is a personal, self-hosted project. It is a **read-only** viewer for Freqtrade; it cannot place orders. Security reports are handled on a best-effort basis.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, and do not include live credentials in any report.

- Use GitHub's **Report a vulnerability** / Security Advisory feature on this repository, or contact the maintainer privately.
- Include the affected commit, a short description, reproduction steps, and the impact you expect. Redact bot URLs, usernames, passwords, and `ADMIN_TOKEN` values.

## Scope

In scope:

- Bypassing the read-only method whitelist in `terminal/worker/core.ts`.
- Leaking bot credentials through API responses, error messages, logs, or the admin page.
- Authenticating to `${ADMIN_PATH}/api/*` (default `/admin/api/*`) without the configured `ADMIN_TOKEN`.
- Treating the configurable `ADMIN_PATH` as an access-control boundary. It only selects the entry URL; authorization is enforced by `ADMIN_TOKEN`.
- Worker routing or request-body handling flaws that expose configuration.

Out of scope:

- The public terminal being visible to anyone who has its URL. That is the intended sharing model; use Cloudflare Access if you need to restrict viewers.
- Weak `ADMIN_TOKEN` values chosen by the operator.
- Denial of service, Cloudflare free-plan quota exhaustion, or issues in Freqtrade itself.
- Vulnerabilities that require access to the Cloudflare account or local machine.

## If a secret leaks

1. Rotate the Freqtrade bot password.
2. Replace `ADMIN_TOKEN` with `wrangler secret put ADMIN_TOKEN`.
3. Check KV for unexpected bots and remove any you did not add.
4. Review `wrangler tail` and Cloudflare audit logs for unexpected admin requests.
