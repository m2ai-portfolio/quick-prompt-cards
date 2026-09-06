# Contract: prompt-run/v2 (multi-bot dispatch)

Status: draft for P2.0 approval (2026-09-05). Supersedes nothing: `prompt-run-v1.md` stays
frozen and its route `/api/prompt-run` keeps working unchanged as the rollback path until Matt
retires it after the two-bot pilot.

## Why v2 exists

v1 can only post the canonical catalog text for a `cardId`. It cannot post a prompt the user
wrote or edited, because the client never sends text and the server has no record of the
user's prompts. Verified on 2026-09-05: renaming the one catalog card and tapping GO posted
the old email prompt; a pinned prompt cannot dispatch at all. v2 fixes this by letting the
server resolve the user's OWN records (see `shared-pocket-v1.md`) and by validating each
launch with the token of the exact bot that launched it.

## Bot registry (server-side, secret-free in source)

The server holds an allowlist of bots. Configuration is by environment variable NAMES; no
token value ever appears in source, docs, browser assets, logs, responses, or Paperclip.

```
PROMPT_POCKET_BOTS=hermes1,beth              # ordered list of enabled public keys
PROMPT_POCKET_BOT_HERMES1_TOKEN=<secret>      # token for key "hermes1"
PROMPT_POCKET_BOT_HERMES1_USERNAME=m2ai_hermes1_bot
PROMPT_POCKET_BOT_BETH_TOKEN=<secret>
PROMPT_POCKET_BOT_BETH_USERNAME=M2ai_beth_bot
PROMPT_POCKET_DISPATCH_DISABLED=1             # optional global kill switch (any value)
```

Rules:

- A public key is `^[a-z][a-z0-9_-]{1,31}$`. The env suffix is the key upper-cased with `-`
  replaced by `_`.
- A key listed in `PROMPT_POCKET_BOTS` without a token fails server STARTUP (fail closed), not
  the first request.
- A key not listed is disabled even if its token variable exists. Removing a key from the list
  is the per-bot kill switch; it takes effect on restart.
- `TELEGRAM_BOT_TOKEN` (v1) is read only by the v1 route. It is never used as a fallback for
  any v2 request. There is no ambiguous default bot.
- The registry exposes `{ key, username, enabled }` for readback and `token` only to the
  validator and the Telegram client.

## Request

`POST /api/v2/prompt-run`

```json
{
  "botKey": "hermes1",
  "initData": "<raw WebApp.initData, unparsed>",
  "target": { "kind": "catalog", "cardId": "clear-email" }
}
```

or

```json
{
  "botKey": "beth",
  "initData": "<raw>",
  "target": { "kind": "record", "recordId": "01J..." }
}
```

- `botKey`: public routing input only. It selects which token validates `initData`. It never
  authenticates anything by itself.
- `initData`: raw, exactly as Telegram provided. Same rule as v1.
- `target.kind = "catalog"`: server posts the canonical catalog text for `cardId`, unmodified
  (v1 behavior).
- `target.kind = "record"`: server loads the prompt record with that id from the shared pocket,
  checks `ownerTelegramUserId` equals the user id derived from the VALIDATED `initData`, and
  posts that record's current `prompt` text. A record that is missing, soft-deleted, or owned
  by someone else returns `unknown_target`; the response never distinguishes "not yours" from
  "does not exist".
- No client field may carry prompt text, a token, a destination, an action type, or an owner
  id. Unknown fields are rejected (`invalid_request`), not ignored.
- Body cap 16 KB, read timeout 10 s (same as v1).

## Validation order (server, before any Telegram call)

1. Exact schema and size. Fail: `400 invalid_request`.
2. `PROMPT_POCKET_DISPATCH_DISABLED` set. Fail: `503 dispatch_disabled`.
3. `botKey` resolves to an ENABLED registry entry. Fail: `400 unknown_bot` (same code for
   unknown and disabled; do not leak which).
4. `initData` HMAC with THAT entry's token, constant-time compare, `auth_date` within 5 min,
   `query_id` present, `user.id` present and numeric. Fail: `400 invalid_init_data` /
   `stale_init_data` / `missing_query_id`. A signature made with Bot A's token sent with Bot
   B's key fails here with `invalid_init_data`.
5. Resolve `target` (catalog lookup, or record lookup scoped by the validated user id at the
   storage layer, never only in the handler). Fail: `400 unknown_target`.
6. Claim `query_id` atomically (v1 claim store, in memory, single process). `409
duplicate_in_progress` / `409 already_consumed` / `200 already_posted` as v1.
7. Rate limit: 30 dispatches per user per 10 minutes across all bots. Fail: `429 rate_limited`.
8. Call `answerWebAppQuery` with the SAME registry entry's token. Never with any other token.

## Responses

```
200 { "status": "posted" }
200 { "status": "already_posted" }
400 { "status": "rejected", "error": "invalid_request" | "unknown_bot" | "invalid_init_data" | "stale_init_data" | "missing_query_id" | "unknown_target" }
409 { "status": "duplicate_in_progress" } | { "status": "already_consumed" }
429 { "status": "rate_limited" }
502 { "status": "telegram_error" }
503 { "status": "dispatch_disabled" }
```

Responses never echo `initData`, hashes, `query_id`, user ids, or prompt text.

## Idempotency, single-use, retry, fallback

Identical to v1: one `query_id` per Mini App session, at most one successful
`answerWebAppQuery` per `query_id`, client never retries a spent `query_id`, ambiguous
outcomes burn it, clipboard fallback exists only outside Telegram. The client message for a
burned session must say "close and reopen Prompt Pocket" only when reopening would actually
help (spent `query_id`), never for a structural reason (unknown bot, disabled dispatch).

## Logging

One structured line per request: `requestId`, `botKey`, outcome status/error, latency. Never
the token, `initData`, hash, `query_id`, user id, record id contents, or prompt text.

## Adversarial cases (tests required before deploy)

- matching key + matching signature: posted
- Bot A signature + Bot B key: `invalid_init_data`, zero Telegram calls
- unknown key, disabled key, malformed key: `unknown_bot`, zero Telegram calls
- forged, stale, oversized, replayed initData: rejected as v1, zero Telegram calls
- extra client fields (`token`, `text`, `ownerId`, `chatId`): `invalid_request`
- record owned by another user: `unknown_target`, zero Telegram calls
- soft-deleted record: `unknown_target`
- `PROMPT_POCKET_DISPATCH_DISABLED`: `dispatch_disabled`, zero Telegram calls
- removing `beth` from `PROMPT_POCKET_BOTS`: beth requests `unknown_bot`, hermes1 unaffected
- v1 route still posts a catalog card with `TELEGRAM_BOT_TOKEN` (rollback path intact)

## Client launch URL

`https://m2ai-portfolio.github.io/quick-prompt-cards/?bot=<key>`. The client parses `bot`
strictly against the same key grammar; a missing or malformed key means "no dispatch, no
pocket sync, local-only mode" with an honest label. The key selects nothing but the request
field; it cannot change the endpoint, the origin, or any permission.
