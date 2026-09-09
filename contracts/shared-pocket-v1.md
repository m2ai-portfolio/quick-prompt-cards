# Contract: shared-pocket/v1 (personal prompt library, synced across approved bots)

Status: draft for P2.0 approval (2026-09-05). Governs server storage, the pocket API, the
session model, and the one-time local import. Read with `prompt-run-v2.md`.

## Product rule

A Telegram user has exactly one pocket. It is the same pocket whether they open Prompt Pocket
from Hermes1 or from Beth, on any device. Ownership is the Telegram user id derived from
server-validated `initData`. Bot identity never owns data; it only decides which token
validates the launch and which bot posts a dispatch.

## Assumptions Matt can override before deploy (stated, not hidden)

| Decision               | Assumed value                                                                                                                                                          | Why                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Storage                | SQLite file via Node's built-in `node:sqlite`, at `PROMPT_POCKET_DATA_DIR/prompt-pocket.sqlite`, WAL mode, on a NAS volume mounted into the existing adapter container | No new vendor or dependency; the container already runs node 22.23; backed up with the NAS |
| Region / encryption    | On the NAS in the house; disk-level only                                                                                                                               | Same posture as every other NAS volume today                                               |
| Backup                 | NAS volume backup plus `sqlite3 .backup` nightly copy to `PROMPT_POCKET_DATA_DIR/backups/` (7 kept)                                                                    | Restorable without the container                                                           |
| Retention after delete | Soft delete, purged after 30 days                                                                                                                                      | Recovery window without keeping data forever                                               |
| Limits                 | 200 records per user, 8 KB prompt, 120 char title, 40 char category                                                                                                    | Bounds storage and dispatch size                                                           |
| Session lifetime       | 24 hours, bound to the launching bot key                                                                                                                               | Covers a day of editing without re-launching                                               |
| Admin access           | Nobody reads prompt content through any admin surface; only raw DB access on the NAS                                                                                   | No admin route is built                                                                    |
| Export                 | `GET /api/v2/pocket/export` returns the owner's records as JSON                                                                                                        | User-driven, no admin needed                                                               |

## Entities

```
users
  telegram_user_id   INTEGER PRIMARY KEY
  created_at         TEXT ISO-8601
  last_seen_at       TEXT

sessions
  token_hash         TEXT PRIMARY KEY   -- sha256 of the opaque token; raw token never stored
  telegram_user_id   INTEGER NOT NULL
  bot_key            TEXT NOT NULL      -- audience: session only valid for the bot that minted it
  created_at         TEXT
  expires_at         TEXT

prompt_records
  id                 TEXT PRIMARY KEY   -- server-generated, 26-char, immutable
  owner_telegram_user_id INTEGER NOT NULL
  source             TEXT NOT NULL      -- 'personal' | 'canonical-override'
  canonical_card_id  TEXT               -- set only for canonical-override
  title              TEXT NOT NULL
  category           TEXT NOT NULL
  prompt             TEXT NOT NULL
  hidden             INTEGER NOT NULL DEFAULT 0   -- canonical-override: user deleted the starter card
  revision           INTEGER NOT NULL DEFAULT 1
  created_at         TEXT
  updated_at         TEXT
  deleted_at         TEXT               -- soft delete
  UNIQUE(owner_telegram_user_id, canonical_card_id) WHERE canonical_card_id IS NOT NULL
```

- `personal`: a prompt the user created (today's "pinned prompt").
- `canonical-override`: the user's edit or deletion of a starter catalog card. The catalog
  card keeps its id; the override carries the user's title/category/prompt and `hidden`.
  Dispatching an override posts the OVERRIDE text (the user's own words), which is the exact
  behavior missing today.
- Every query that reads or writes `prompt_records` includes `owner_telegram_user_id = ?` at
  the SQL level. Handlers never filter after the fact.

## Session

`POST /api/v2/session` `{ "botKey": "hermes1", "initData": "<raw>" }`

1. Validate exactly as `prompt-run-v2.md` steps 1, 3, 4 (no `query_id` requirement here: a
   session may be minted from any launch surface that carries signed `initData`).
2. Upsert `users`.
3. Mint 32 random bytes, return base64url token; store only its sha256.
4. Response `200 { "expiresAt": "<ISO>" }` plus the token in the body field `sessionToken`.
   No user id, no username, no bot token.

Pocket routes require `Authorization: Bearer <sessionToken>` and the `X-Bot-Key` header
matching the session's `bot_key`. Mismatch or expiry: `401 session_invalid`. Sessions are
deleted on expiry sweep (hourly) and on `POST /api/v2/session/logout`.

## Pocket API (all owner-scoped by the session's user id)

```
GET    /api/v2/pocket                 -> { records: PromptRecord[], limits: {...} }   (excludes soft-deleted)
POST   /api/v2/pocket/records         { source, localId, canonicalCardId?, title, category, prompt, hidden? } -> { record }
PATCH  /api/v2/pocket/records/:id     { revision, title?, category?, prompt?, hidden? } -> { record } | 409 revision_conflict { current }
DELETE /api/v2/pocket/records/:id     -> 204 (soft delete)
POST   /api/v2/pocket/records/:id/restore  -> { record }  (within 30 days)
POST   /api/v2/pocket/import          { records: LocalRecord[] } -> { imported: string[], skipped: string[], records: PromptRecord[] }
GET    /api/v2/pocket/export          -> { exportedAt, records: PromptRecord[] } (includes soft-deleted with deletedAt)
DELETE /api/v2/pocket                 { "confirm": "delete everything" } -> 204 (hard delete all owner rows + sessions)
```

`PromptRecord` on the wire: `{ id, source, canonicalCardId, title, category, prompt, hidden,
revision, createdAt, updatedAt }`. Never `ownerTelegramUserId`.

Rules:

- Create validates limits; exceeding count: `400 limit_exceeded`.
- `localId` (amended 2026-09-09) is REQUIRED on every create: a client-generated
  idempotency key (1-200 chars), minted once when the user pins/edits/hides and
  reused verbatim by every retry of that same create. The server dedupes on
  `(owner_telegram_user_id, localId)`: a replayed create returns the record the
  FIRST attempt made — never a second row — even after a timeout, a 5xx, or the
  Mini App closing mid-flight. The mapping persists (owner-scoped table) and is
  not affected by soft delete or the 30-day purge of prompt records. Another
  user's `localId` is independent; the same value under two owners creates two
  records. A missing, empty, oversized, or non-string `localId` is
  `400 invalid_request`.
- Creating a second `canonical-override` for the same `canonicalCardId` returns the existing
  one (idempotent), never a duplicate.
- PATCH is compare-and-swap on `revision`; success increments it.
- Import: each `LocalRecord` is `{ localId, source, canonicalCardId?, title, category, prompt,
hidden? }`. Dedupe key is `(source, canonicalCardId ?? sha256(title + "\n" + prompt))`
  against the owner's existing records; duplicates are `skipped` and mapped to the existing
  id in `records`. Import is idempotent: replaying the same payload creates nothing.
- Rate limit: 120 pocket requests per user per 10 minutes.
- Prompt content never appears in logs. Logs carry request id, bot key, route, status.

## Client behavior (frontend contract)

- On launch inside Telegram with a valid `?bot=` key and signed `initData`: mint a session,
  load the pocket, render from server state. Local storage becomes a read-through cache
  keyed by user id so an offline reopen still shows the last pocket.
- Outside Telegram, or with no/invalid bot key, or if the session call fails: local-only mode
  exactly as today, with a one-line label "Not synced: open from Hermes1 or Beth".
- First authenticated launch on a device that holds local pins/edits: show a consent dialog
  with the exact count ("3 pinned prompts, 1 edited card"). Upload only on "Import". Keep
  local data until the import response lists every local id as imported or skipped and a
  fresh `GET /pocket` readback contains them; only then mark migration done in local storage
  (`prompt-pocket:migration:v1:<userId> = done`). "Skip" keeps local data and asks again next
  launch; "Never" records `dismissed` and stops asking.
- Edits and deletes go to the server first; on failure the UI keeps the user's text, shows
  "Couldn't sync, try again", and does not silently fall back to local-only.
- GO on a personal or override record uses `prompt-run-v2` with `target.kind = "record"`.
  GO on an unedited starter card uses `target.kind = "catalog"`.
- Every create mints its `localId` ONCE per user action (at pin/edit/hide time)
  and carries it through retries; the client never mints a new key for a retry
  of the same change (amended 2026-09-09).

## Adversarial cases (tests required before deploy)

- User A's session cannot read, update, delete, restore, export, or dispatch User B's record
  (every route, asserted at HTTP level with two signed users).
- The same user through `hermes1` and `beth` sessions sees the same records and edits round
  trip both ways.
- A `hermes1` session token with `X-Bot-Key: beth`: `session_invalid`.
- Expired session: `session_invalid`; a new session mints normally.
- Stale `revision` PATCH: `409 revision_conflict` with the current record.
- Import replayed twice: second call imports nothing.
- Interrupted import (server error mid-batch): the batch is one transaction; nothing partial.
- Oversized prompt, over-limit count: `limit_exceeded`, nothing written.
- Create replayed with the same `localId` (timeout + retry): the first record is
  returned again; the owner's record count is unchanged (amended 2026-09-09).
- Soft-deleted record: absent from GET, present in export with `deletedAt`, restorable, and
  `unknown_target` for dispatch.
- Purge job removes rows older than 30 days after `deleted_at` and nothing else.

## Rollback

Disable v2 by removing the pocket and v2 routes from nginx (one location block) or by
stopping the v2 container tag and restoring `prompt-pocket-server:011886d`. v1 dispatch and
local-only frontend keep working. The SQLite file is left in place; data is retained per the
policy above.
