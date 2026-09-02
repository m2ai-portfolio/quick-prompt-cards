# Contract: prompt-run/v1

Status: frozen (A1). No implementation exists yet. This document is the interface A3/A4 must
build against; it does not itself ship a server or client change beyond typing in
`src/vite-env.d.ts`.

## Capability finding (A1)

**Verified against official Telegram Bot API documentation** (`core.telegram.org/bots/webapps`,
fetched 2026-09-02):

- A Mini App opened from the bot's persistent **Menu Button** launches "in the exact same way
  as when using inline buttons": `WebApp.initDataUnsafe.query_id` is present.
- `query_id` is described as "a unique identifier for the Mini App session, required for
  sending messages via the `answerWebAppQuery` method."
- `answerWebAppQuery` (Bot API method, server-side only, requires the bot token) "sends an
  inline message from the user back to the bot and close[s] the Mini App." It fires
  automatically once the server calls it: no second tap, no user-side send action.
- `sendData` was considered and rejected: it is "only available for Mini Apps launched via a
  Keyboard button," which is not this product's launch context (Menu Button).
- Inline-mode launches (`@bot query` typed by the user) do **not** carry a usable one-tap
  path here: the docs describe that surface as having no access to the chat outside the
  query/result exchange, and it requires the user to pick a result, which is a second tap.
  It is not used by this product.

**Conclusion:** the Menu Button launch supports the one-tap mechanism the product goal
requires (`{ cardId, initData }` -> server validates -> `answerWebAppQuery` posts a
user-authorized message). No kill condition is triggered by documentation.

**A1 closure (manager decision, lease 2, 2026-09-02):** documented Telegram Bot API behavior
is sufficient evidence to close A1 and to build A3/A4 against this contract. The real-device
confirmation below is deferred: it is a **pre-release integration gate**, not an A3
implementation blocker. A3/A4 may proceed against the documented mechanism.

### Evidence still required before release (pre-release integration gate, not an A3 blocker)

A human with the real Prompt Pocket bot in Telegram must, before this flow ships to real
users:

1. Open Prompt Pocket via the bot's Menu Button (the actual configured launch surface, not
   a browser tab).
2. In the Mini App's dev console (or a temporary debug line), read
   `window.Telegram.WebApp.initDataUnsafe`.
3. Report back, redacted: whether a `query_id` key is present (yes/no) and whether `user`,
   `auth_date`, and `hash` are present (yes/no each). **Do not paste the raw `initData`
   string, the `hash` value, the `query_id` value, or any `user.id`/username.** Field
   presence only.

This evidence gates release (tracked at A4/A7), not A1's contract freeze and not A3's start.
The contract is written from documented behavior; A3 may build server code against it now.

## Request

Client -> server, single endpoint, POST:

```
{
  "cardId": string,      // matches a canonical prompt-catalog card ID (A2's shared-catalog is authoritative; this contract does not define catalog storage)
  "initData": string     // raw, unparsed WebApp.initData string, exactly as Telegram provided it
}
```

The client never sends a parsed/derived copy of `initData`, never sends the bot token, and
never sends the prompt text (the server resolves the prompt from `cardId` against its own
catalog, never trusts client-supplied prompt content).

## Validation (server-side, before any other step)

1. Recompute the data-check-string from `initData` (all fields except `hash`, sorted
   alphabetically as `key=value` joined by `\n`). Derive `secret_key = HMAC_SHA256(key:
   "WebAppData", message: bot_token)`, then compute
   `expected_hash = HMAC_SHA256(key: secret_key, message: data_check_string)`. Compare
   `expected_hash` to the received `hash` using a constant-time comparison. Reject on
   mismatch with a generic `invalid_init_data` error; do not echo the received hash.
   (Verified against `core.telegram.org/bots/webapps`, "Validating data received via the
   Mini App": the constant `WebAppData` is the HMAC key for deriving the secret, the bot
   token is the message; the secret is then the key for the outer HMAC over the
   data-check-string.)
2. Reject if `auth_date` is older than 5 minutes (chosen conservative bound; Telegram's docs
   do not mandate a figure). Error: `stale_init_data`.
3. Parse `query_id` from the same server-validated `initData` query string used in step 1 —
   never from `window.Telegram.WebApp.initDataUnsafe`, which is a browser-side convenience
   object, is never sent by the client in this contract's request, and would be
   attacker-controlled if it were. `initData` is a URL-encoded query string; `query_id` is
   one of its top-level fields alongside `hash`, `auth_date`, and `user`, and is only trusted
   once step 1's HMAC check has passed. Reject if the parsed `query_id` is absent. Error:
   `missing_query_id` — this is the signal that the launch context did not support one-tap
   posting (e.g. opened outside Telegram, or via an unsupported launch surface); the client
   is expected to fall back per the fallback boundary below, not retry the same request. The
   parsed, validated `query_id` is the value used for the idempotency check below and as the
   argument to `answerWebAppQuery`.
4. Reject if `cardId` does not resolve against the canonical server-side prompt catalog.
   Error: `unknown_card`.
5. All rejections return a safe, non-leaking error code from the enum above; no stack trace,
   no echoed secret material, no raw `initData` in logs or responses.

## Outcomes

| Outcome | Condition | Client-visible result |
|---|---|---|
| `posted` | `answerWebAppQuery` succeeded | Mini App closes (Telegram's own behavior); bot chat shows the posted prompt as a user message, followed by the existing bot's normal response. |
| `rejected` | Any validation failure above | Mini App stays open; user sees the specific safe error and, where applicable, the fallback affordance. |
| `telegram_error` | `answerWebAppQuery` call itself failed (Telegram API error, transport failure) | See retry boundary below. |

## Idempotency key

The idempotency key is the Telegram-issued `query_id` itself, as parsed from the
server-validated `initData` string (see Validation step 3), never the client-side
`initDataUnsafe.query_id`. It is opaque, single-use, and already unique per Mini App session
— the server does not mint its own key. The server must track `query_id` values it has
already attempted to answer (in-memory or short-TTL store is sufficient; `query_id` sessions
are short-lived) to detect a duplicate client request for a `query_id` already consumed.

## Single-use / retry boundary

- A `query_id` may be the subject of **at most one successful `answerWebAppQuery` call**.
  Telegram enforces this Mini-App-session-scoped one-shot semantics; the server does not
  need its own second enforcement layer beyond not calling it twice.
- The server MAY retry its own call to `answerWebAppQuery` **only** when the failure proves
  zero request bytes were ever written to Telegram's edge: a DNS resolution failure or a
  connection refused/failed before the request was sent. These are the only failure modes
  that prove Telegram could not have processed the call.
- Every other failure is ambiguous and MUST NOT be retried, including: a timeout with no
  response received after the request was sent (Telegram may have received and processed it
  before the response was lost), a socket reset mid-response, and any 5xx status from
  Telegram (a 5xx means Telegram's edge received and attempted to process the request; it
  does not prove `answerWebAppQuery` did not execute). All of these are treated as
  `telegram_error` and surfaced to the client as final, non-replayable.
- The client MUST NOT retry the same `query_id` under any circumstance. On `telegram_error`
  or `missing_query_id`, or on receiving no response within a bounded client-side timeout
  (recommend 8s), the client tells the user to close and reopen Prompt Pocket (a fresh Menu
  Button launch mints a fresh `query_id`). This satisfies the goal's "no duplicate posting"
  and "no silent second-tap flow" requirements.
- Duplicate-tap suppression on the client (A4 concern) must disable the card action
  immediately on first tap, before the network round-trip, so a fast double-tap cannot
  produce two requests for the same `query_id`.

## Fallback boundary

- The fallback (explicit clipboard copy with an on-screen explanation) applies **only**
  outside Telegram, or when `missing_query_id` is returned (unsupported launch context).
- The fallback is never triggered silently from inside a supported Telegram session. A
  `telegram_error` on an otherwise-valid request does not fall back to clipboard
  automatically; per the goal, that would risk a duplicate post if the `answerWebAppQuery`
  call actually landed. The user is told to relaunch, not silently redirected to clipboard.

## Storage boundary

- The server never persists raw `initData`, the `hash`, or the `query_id` value beyond the
  short-lived in-flight tracking needed for the single-use check (see Idempotency key). That
  tracking entry is discardable once the `query_id`'s Mini-App session has expired
  (Telegram-side; treat anything older than a few minutes as expired for cleanup purposes).
- No credential (bot token) is ever sent to, stored in, or derivable from browser code. It
  exists only in the server's environment.
- Evidence collected for this issue (A1) must never include raw `initData`, `hash`, or
  `query_id` values — see "Evidence still required" above.
