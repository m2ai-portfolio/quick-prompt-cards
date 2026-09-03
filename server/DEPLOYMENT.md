# Deployment decision: prompt-run-v1 adapter (A3)

Status: decision recorded, not yet deployed. A3 ships the adapter code and
its test suite; standing up a live, internet-reachable instance is a
release-gate action for A7/A4, not this issue.

## Why it cannot live on GitHub Pages

The existing Prompt Pocket client (`src/`) builds to a static site served
from `docs/` via GitHub Pages (see `vite.config.ts`). GitHub Pages serves
static files only: it cannot hold `TELEGRAM_BOT_TOKEN`, cannot run
server-side HMAC validation, and cannot call Telegram's `answerWebAppQuery`
(a Bot API method that requires the token and must never reach browser
code). Tracker item B-004 already recorded this constraint.

## Chosen shape

A minimal, dependency-free Node HTTP process (`server/http-server.ts`,
entrypoint `server/index.ts`) exposing exactly one route,
`POST /api/prompt-run`, matching `contracts/prompt-run-v1.md`. No web
framework was added: the route surface is one endpoint with a small,
fully-tested request/response contract, so Express/Fastify would add a
dependency without reducing code.

- **Runtime**: plain `node:http`, TypeScript compiled via
  `npm run build:server` (`tsc -p tsconfig.server.json`, emits to
  `server/dist/`, gitignored) and started with `npm run start:server`.
- **Secret**: `TELEGRAM_BOT_TOKEN` is read once from `process.env` in
  `server/index.ts` and passed down as a constructor argument. It is never
  imported by, referenced from, or reachable through anything under `src/`.
  `npm run build` (the browser build) does not import `server/**`.
- **State**: the query_id idempotency claim (`server/query-claim-store.ts`)
  is in-memory, matching the contract's "may be in memory for a
  single-process deployment" allowance. A multi-instance deployment would
  need a shared atomic store instead; that is out of scope until traffic or
  redundancy requirements justify it (YAGNI today, not a hidden gap: the
  contract explicitly permits in-memory for single-process).
- **Timeouts**: an 8s default bound on the outbound Telegram call
  (`server/telegram-client.ts`) and a 10s bound plus 16KB body cap on
  inbound request reads (`server/http-server.ts`), so neither a slow
  Telegram response nor a slow/oversized client request can hang the
  process.
- **CORS**: the Mini App is served from GitHub Pages, a different origin
  than this server, so the browser sends a preflight `OPTIONS` request
  before the real `POST`. `server/http-server.ts` answers the preflight and
  reflects `access-control-allow-origin` only for the configured origin
  (default `https://m2ai-portfolio.github.io`, matching the production
  site in `README.md`; override with `ALLOWED_ORIGIN` for a staging
  deployment). Any other origin gets no CORS headers and the browser
  blocks the request client-side.

## Where it should run (recommendation, not executed by this issue)

A small always-on process behind HTTPS, reachable at a stable URL the
client's `sendWebAppQuery` (A4) can call. M2AI's existing NAS/Portainer
infrastructure (`https://10.0.0.49:19943`) is the natural home given it
already hosts other long-running M2AI services, fronted by the existing
reverse-proxy/HTTPS convention rather than a new one. No paid or new cloud
service is required. Actually provisioning this (container, secret
injection, DNS/HTTPS, Telegram Menu Button URL update) is deliberately left
to the A4/A7 integration issues, which own the real-device verification
that must happen before anything is exposed to real users.
