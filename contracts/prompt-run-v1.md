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

**Outstanding verification (not closeable by this agent):** the goal requires "redacted
real-device evidence" from the actual deployed Prompt Pocket Mini App and its real bot, not
documentation alone. This agent has no physical device or live Telegram client session
available in this environment. See "Evidence still required" below. Per the issue's kill
clause, this contract is written on the documented mechanism, but A3/A4 must not begin
implementation against unconfirmed device behavior — the confirmation step below is a
precondition, not a formality.

### Evidence still required before A3 starts

A human with the real Prompt Pocket bot in Telegram must:

1. Open Prompt Pocket via the bot's Menu Button (the actual configured launch surface, not
   a browser tab).
2. In the Mini App's dev console (or a temporary debug line), read
   `window.Telegram.WebApp.initDataUnsafe`.
3. Report back, redacted: whether a `query_id` key is present (yes/no) and whether `user`,
   `auth_date`, and `hash` are present (yes/no each). **Do not paste the raw `initData`
   string, the `hash` value, the `query_id` value, or any `user.id`/username.** Field
   presence only.

This evidence gates A3 (server build), not A1's contract freeze — the contract can be
written from documented behavior, but no server code should be built against it until the
live query_id presence is confirmed on the real launch surface.

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
   alphabetically as `key=value` joined by `\n`) and verify
   `HMAC_SHA256(data_check_string, HMAC_SHA256(bot_token, "WebAppData")) == hash`. Reject on
   mismatch with a generic `invalid_init_data` error; do not echo the received hash.
2. Reject if `auth_date` is older than 5 minutes (chosen conservative bound; Telegram's docs
   do not mandate a figure). Error: `stale_init_data`.
3. Reject if `initDataUnsafe.query_id` is absent. Error: `missing_query_id` — this is the
   signal that the launch context did not support one-tap posting (e.g. opened outside
   Telegram, or via an unsupported launch surface); the client is expected to fall back per
   the fallback boundary below, not retry the same request.
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

The idempotency key is the Telegram-issued `query_id` itself. It is opaque, single-use, and
already unique per Mini App session — the server does not mint its own key. The server must
track `query_id` values it has already attempted to answer (in-memory or short-TTL store is
sufficient; `query_id` sessions are short-lived) to detect a duplicate client request for a
`query_id` already consumed.

## Single-use / retry boundary

- A `query_id` may be the subject of **at most one successful `answerWebAppQuery` call**.
  Telegram enforces this Mini-App-session-scoped one-shot semantics; the server does not
  need its own second enforcement layer beyond not calling it twice.
- The server MAY retry its own call to `answerWebAppQuery` **only** for a transport-level
  failure that is provably pre-acceptance (connection refused, timeout with no response
  received, 5xx from Telegram) and only before any response (success or definitive failure)
  has been received from Telegram for that `query_id`.
- The server MUST NOT retry after an ambiguous outcome (e.g. timeout after the request was
  sent but a response may have been received by Telegram's edge, socket reset mid-response).
  An ambiguous outcome is treated as `telegram_error` and surfaced to the client as final.
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
