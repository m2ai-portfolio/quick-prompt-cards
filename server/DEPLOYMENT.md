# Deployment: Prompt Pocket adapter (v1 dispatch + Phase 2 shared pocket)

Status: Phase 2 server code is built and tested on `feat/phase2-shared-pocket`. Nothing
in this document has been executed against the NAS. Every step below is a proposed
change for the authorized cutover; no deployment, ingress, DNS, BotFather, or Telegram
mutation is authorized by this file.

Contracts served: `contracts/prompt-run-v1.md` (frozen, rollback path),
`contracts/prompt-run-v2.md`, `contracts/shared-pocket-v1.md`. Wire types:
`shared/pocket-contract.ts`.

## What the process serves

| Route                                      | Contract         | Auth                                        |
| ------------------------------------------ | ---------------- | ------------------------------------------- |
| `GET /health`                              | health           | none, body is exactly `{"status":"ok"}`     |
| `POST /api/prompt-run`                     | prompt-run/v1    | signed `initData` with `TELEGRAM_BOT_TOKEN` |
| `POST /api/v2/prompt-run`                  | prompt-run/v2    | signed `initData` with the `botKey`'s token |
| `POST /api/v2/session`                     | shared-pocket/v1 | signed `initData` with the `botKey`'s token |
| `POST /api/v2/session/logout`              | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `GET, DELETE /api/v2/pocket`               | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `POST /api/v2/pocket/records`              | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `PATCH, DELETE /api/v2/pocket/records/:id` | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `POST /api/v2/pocket/records/:id/restore`  | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `POST /api/v2/pocket/import`               | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |
| `GET /api/v2/pocket/export`                | shared-pocket/v1 | `Authorization: Bearer` + `X-Bot-Key`       |

Everything else is `404 {"status":"not_found"}`. The process is single-instance: the
`query_id` claim store and both rate limiters (30 dispatches and 120 pocket requests per
user per 10 minutes) are in memory. Do not add replicas.

## Runtime and secret boundary

- Dependency-free `node:http` process, TypeScript compiled by `npm run build:server`
  (`tsc -p tsconfig.server.json`, emits `server/dist/`, gitignored).
- Storage: SQLite through Node's built-in `node:sqlite`, file
  `PROMPT_POCKET_DATA_DIR/prompt-pocket.sqlite`, WAL mode. Node prints one
  `ExperimentalWarning: SQLite is an experimental feature` line at startup; expected.
- Tokens are read from the environment once at startup and passed down as constructor
  arguments. No token is ever imported by `src/`, written to logs, echoed in a response,
  or listed by value in this file. The registry's readback surface (`list()`) carries
  only `key`, `username`, `enabled`.
- `TELEGRAM_BOT_TOKEN` serves only the v1 route. It is never a fallback for a v2 request.
- Request logs are one JSON line per request with exactly `requestId`, `botKey`,
  `route`, `status`, `latencyMs`. No `initData`, hash, `query_id`, user id, record id,
  or prompt text is logged.

## Environment variables (names only)

| Name                               | Required                      | Meaning                                                                                          |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `PORT`                             | no (default 8787)             | Listen port. The image sets `3000` to match `EXPOSE 3000`.                                       |
| `ALLOWED_ORIGIN`                   | no (default production site)  | CORS allow-origin. Must stay `https://m2ai-portfolio.github.io` in production.                   |
| `TELEGRAM_BOT_TOKEN`               | no                            | v1 route only. Absent: `POST /api/prompt-run` is 404.                                            |
| `PROMPT_POCKET_BOTS`               | no                            | Ordered comma list of enabled public keys, each `^[a-z][a-z0-9_-]{1,31}$`. Absent: v2 is 404.    |
| `PROMPT_POCKET_BOT_<KEY>_TOKEN`    | yes for every listed key      | Bot token for `<KEY>` (key upper-cased, `-` becomes `_`). Missing: startup fails.                |
| `PROMPT_POCKET_BOT_<KEY>_USERNAME` | no                            | Readback only.                                                                                   |
| `PROMPT_POCKET_DATA_DIR`           | yes when `PROMPT_POCKET_BOTS` | Directory holding `prompt-pocket.sqlite`. Set to `/data` in the container.                       |
| `PROMPT_POCKET_DISPATCH_DISABLED`  | no                            | Global v2 dispatch kill switch. Being SET (any value, even empty) disables; remove it to enable. |
| `NODE_ENV`                         | no                            | `production`.                                                                                    |

At least one of `TELEGRAM_BOT_TOKEN` or `PROMPT_POCKET_BOTS` must be set or startup fails.

## Image build

There was no Dockerfile in the repo before Phase 2; `server/Dockerfile` is the build
recipe. It copies only compiled output plus the root `package.json` (needed so Node loads
`server/dist/**/*.js` as ES modules) and fails the build if the base image lacks
`node:sqlite`.

```bash
# on the ProBook, in the reviewed checkout
npm ci
npm run build:server
SHA=$(git rev-parse --short HEAD)
docker build -f server/Dockerfile -t prompt-pocket-server:$SHA .
docker save prompt-pocket-server:$SHA | gzip > /tmp/prompt-pocket-server-$SHA.tar.gz
# transfer to the NAS and load it (Portainer: Images > Import), or build on the NAS
```

Tag the image with the git SHA of the reviewed commit; never `latest`. The tag is the
rollback handle.

## Stack: `prompt-pocket-server` (Portainer stack id 33, replace in place)

Token values are supplied as Portainer stack environment variables, never written into
the compose text. Keep `TELEGRAM_BOT_TOKEN` so the v1 route remains the rollback path.

```yaml
services:
  prompt-pocket-server:
    image: prompt-pocket-server:<git-sha>
    container_name: prompt-pocket-server
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3000"
      ALLOWED_ORIGIN: https://m2ai-portfolio.github.io
      PROMPT_POCKET_DATA_DIR: /data
      PROMPT_POCKET_BOTS: hermes1,beth
      PROMPT_POCKET_BOT_HERMES1_USERNAME: m2ai_hermes1_bot
      PROMPT_POCKET_BOT_BETH_USERNAME: M2ai_beth_bot
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      PROMPT_POCKET_BOT_HERMES1_TOKEN: ${PROMPT_POCKET_BOT_HERMES1_TOKEN}
      PROMPT_POCKET_BOT_BETH_TOKEN: ${PROMPT_POCKET_BOT_BETH_TOKEN}
    volumes:
      - /volume1/Docker/prompt-pocket/data:/data
    networks:
      - n8n-ingress_ingress
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          'fetch(''http://127.0.0.1:3000/health'').then(r=>r.text()).then(t=>process.exit(t===''{"status":"ok"}''?0:1)).catch(()=>process.exit(1))',
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

networks:
  n8n-ingress_ingress:
    external: true
```

Before the first start: create `/volume1/Docker/prompt-pocket/data` on the NAS, owned by
the uid the container runs as (`node`, uid 1000 in `node:22-alpine`), or the process fails
at startup opening the database (fail closed, nothing served).

Bot order and which bots are listed is Matt's decision at cutover (HIL checkpoint in
`pp-phaseA-recon-report.md`). `hermes1,beth` above mirrors the contract example. Removing
a key from `PROMPT_POCKET_BOTS` and redeploying is the per-bot kill switch; existing
sessions minted by that bot stop verifying immediately.

## Ingress: `n8n-ingress` nginx (`/volume1/Docker/n8n-ingress/nginx.conf`)

The current ingress maps only `POST /prompt-pocket/api/prompt-run`. Add these two
location blocks inside the existing `n8n.st-metro.dev` server block. The trailing slash
on both `location` and `proxy_pass` strips the `/prompt-pocket` prefix, so
`/prompt-pocket/api/v2/pocket` reaches the adapter as `/api/v2/pocket`. An existing
`location = /prompt-pocket/api/prompt-run` exact block may stay; exact matches win and
its behavior is unchanged.

```nginx
    # Prompt Pocket adapter: health (Docker + external monitors)
    location = /prompt-pocket/health {
        proxy_pass http://prompt-pocket-server:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Prompt Pocket adapter: v1 dispatch, v2 dispatch, session, pocket API
    location /prompt-pocket/api/ {
        proxy_pass http://prompt-pocket-server:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 2m;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
```

`client_max_body_size 2m` exists only for `POST /api/v2/pocket/import` (up to 200 records
of 8 KB each); the adapter itself caps every other v2 body at 64 KB and v1 plus dispatch
bodies at 16 KB. Reload nginx with `nginx -s reload` inside the `n8n-ingress-proxy`
container (Portainer console); a config error leaves the running config in place.

The nginx.conf contents were not read while writing this section; the upstream name
`prompt-pocket-server:3000` assumes the container name above on the shared ingress
network. If the existing exact-match block proxies to a different port, align `PORT`
and both blocks to that value rather than running two ports.

## Data, retention, backup

- Soft-deleted records are purged 30 days after `deleted_at` by an hourly in-process job;
  expired sessions are swept hourly.
- Nightly consistent copy (the contract's assumed backup), run from the NAS scheduler:

```bash
docker exec prompt-pocket-server node -e "const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');fs.mkdirSync('/data/backups',{recursive:true});const db=new DatabaseSync('/data/prompt-pocket.sqlite');db.exec(\"VACUUM INTO '/data/backups/prompt-pocket-'||strftime('%Y%m%d','now')||'.sqlite'\");db.close()"
find /volume1/Docker/prompt-pocket/data/backups -name 'prompt-pocket-*.sqlite' -mtime +7 -delete
```

`VACUUM INTO` produces a consistent single-file copy while WAL is active without stopping
the service. The NAS volume backup covers the directory as a whole.

## Verification probes (read-only, after an authorized deploy)

1. `curl -s https://n8n.st-metro.dev/prompt-pocket/health` returns `{"status":"ok"}`.
2. `OPTIONS` from `https://m2ai-portfolio.github.io` on `/prompt-pocket/api/v2/pocket`
   returns 204 with `access-control-allow-headers` containing `content-type,
authorization, x-bot-key` and `access-control-allow-methods` containing `PATCH` and
   `DELETE`; an unrelated origin gets no allow-origin header.
3. `POST /prompt-pocket/api/v2/session` with `{"botKey":"nobody","initData":"x"}`
   returns `400 {"status":"rejected","error":"unknown_bot"}`; with an extra field
   returns `invalid_request`.
4. `GET /prompt-pocket/api/v2/pocket` without headers returns
   `401 {"status":"rejected","error":"session_invalid"}`.
5. `POST /prompt-pocket/api/prompt-run` with an invalid fixture still returns the v1
   shape `{"status":"rejected","error":"invalid_init_data"}`.
6. Container logs show one JSON line per probe with only the five log fields.

No token-backed POST is a probe. The real-device dispatch check belongs to the
integration gate, not to this document.

## Rollback

Softest first; each step is independent and reversible.

1. **Kill v2 dispatch only** (pocket stays readable): add
   `PROMPT_POCKET_DISPATCH_DISABLED=1` to the stack and redeploy. v2 dispatch returns
   `503 {"status":"dispatch_disabled"}`, v1 keeps posting.
2. **Kill one bot**: remove its key from `PROMPT_POCKET_BOTS`, redeploy. That bot's
   launches get `unknown_bot`, its sessions stop verifying, other bots are unaffected.
3. **Kill all v2 routes, keep v1**: remove `PROMPT_POCKET_BOTS` from the stack and
   redeploy. Every v2 route becomes 404, the SQLite file is left in place untouched.
4. **Restore the previous image**: set the stack image back to
   `prompt-pocket-server:011886d` (image id
   `sha256:63f11ade83fd0d6545846c7088dc66c7f1965510f3763989a6c0cca1aa05ee52`), keep
   `TELEGRAM_BOT_TOKEN`, `ALLOWED_ORIGIN`, `PORT`, `NODE_ENV`; the old image ignores the
   v2 variables. Remove the `/prompt-pocket/api/` prefix block and the
   `/prompt-pocket/health` block from nginx if the previous exact-match block was
   replaced rather than kept; reload nginx.
5. The frontend rollback baseline is unchanged: origin/main `5af3cac4d7c7`, served asset
   `assets/index-C8G80RmU.js` (SHA-256 `acf83220457879a8ab4db16e222f9637d2b4c3d476cf7c179fe29e48e8e345b4`),
   which contains no adapter URL.

Data is retained through every rollback step per the contract's retention policy.
Routine rollback does not rotate any bot token; rotate only on suspected compromise or
Matt's explicit instruction.
