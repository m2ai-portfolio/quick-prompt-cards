import type {
  DispatchTarget,
  PromptRunV2Response,
} from "../shared/pocket-contract.js";
import type { BotRegistry } from "./bot-registry.js";
import { resolveCard } from "./catalog.js";
import { validateInitDataIdentity } from "./init-data.js";
import type { PocketStore } from "./pocket-store.js";
import type { QueryClaimStore } from "./query-claim-store.js";
import type { SlidingWindowRateLimiter } from "./rate-limit.js";
import { answerWebAppQuery, type FetchLike } from "./telegram-client.js";

export type PromptRunV2Result = {
  httpStatus: 200 | 400 | 409 | 429 | 502 | 503;
  body: PromptRunV2Response;
};

export type PromptRunV2Dependencies = {
  registry: BotRegistry;
  store: PocketStore;
  claimStore: QueryClaimStore;
  rateLimiter: SlidingWindowRateLimiter;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Bot API limit for InputTextMessageContent.message_text (1 to 4096
 * characters, counted as UTF-16 code units, which is what `String.length`
 * measures). A record may store up to POCKET_LIMITS.maxPromptBytes (8 KB), so
 * a stored prompt can exceed what Telegram will post. Checked in step 5,
 * BEFORE the query_id is claimed, so the launch is not spent and Telegram is
 * never called with text it would reject.
 */
export const TELEGRAM_MAX_MESSAGE_TEXT_CHARS = 4096;

/**
 * Rejection code for a target whose text exceeds Telegram's 4096-char
 * message limit (contracts/prompt-run-v2.md, amendment 2026-09-09: dedicated
 * code in the PromptRunV2Rejection union). Checked in step 5, BEFORE the
 * query_id is claimed, so the launch is not spent and Telegram is never
 * called with text it would reject; the client maps it to structural
 * (non-burning) copy.
 */
const UNDISPATCHABLE_TARGET: Extract<
  PromptRunV2Response,
  { status: "rejected" }
>["error"] = "prompt_too_long";

type ParsedRequest = {
  botKey: string;
  initData: string;
  target: DispatchTarget;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const present = Object.keys(obj);
  return present.length === keys.length && keys.every((key) => key in obj);
}

function parseRequest(body: unknown): ParsedRequest | undefined {
  if (
    !isPlainObject(body) ||
    !exactKeys(body, ["botKey", "initData", "target"])
  ) {
    return undefined;
  }
  const { botKey, initData, target } = body;
  if (typeof botKey !== "string" || typeof initData !== "string")
    return undefined;
  if (!isPlainObject(target)) return undefined;

  if (target.kind === "catalog") {
    if (
      !exactKeys(target, ["kind", "cardId"]) ||
      typeof target.cardId !== "string"
    ) {
      return undefined;
    }
    return {
      botKey,
      initData,
      target: { kind: "catalog", cardId: target.cardId },
    };
  }
  if (target.kind === "record") {
    if (
      !exactKeys(target, ["kind", "recordId"]) ||
      typeof target.recordId !== "string"
    ) {
      return undefined;
    }
    return {
      botKey,
      initData,
      target: { kind: "record", recordId: target.recordId },
    };
  }
  return undefined;
}

function rejected(
  error: Extract<PromptRunV2Response, { status: "rejected" }>["error"],
): PromptRunV2Result {
  return { httpStatus: 400, body: { status: "rejected", error } };
}

/**
 * contracts/prompt-run-v2.md "Validation order", steps 1 through 8, in that
 * order. The registry entry resolved in step 3 supplies the token for BOTH
 * the initData check (step 4) and the Telegram call (step 8); no other token
 * is ever consulted. Record targets are resolved by the store with the
 * validated user id in the SQL, so a foreign, deleted, or missing record is
 * indistinguishable from the outside.
 */
export async function handlePromptRunV2(
  body: unknown,
  deps: PromptRunV2Dependencies,
): Promise<PromptRunV2Result> {
  const request = parseRequest(body);
  if (!request) return rejected("invalid_request");

  if (deps.registry.dispatchDisabled) {
    return { httpStatus: 503, body: { status: "dispatch_disabled" } };
  }

  const bot = deps.registry.resolve(request.botKey);
  if (!bot) return rejected("unknown_bot");

  const nowMs = deps.now?.() ?? Date.now();
  const identity = validateInitDataIdentity(
    request.initData,
    bot.token,
    Math.floor(nowMs / 1000),
    { requireQueryId: true },
  );
  if (!identity.ok) return rejected(identity.error);
  const queryId = identity.queryId;
  if (queryId === null) return rejected("missing_query_id");

  let text: string | undefined;
  if (request.target.kind === "catalog") {
    text = resolveCard(request.target.cardId)?.prompt;
  } else {
    text = deps.store.getActiveRecord(
      identity.userId,
      request.target.recordId,
    )?.prompt;
  }
  if (text === undefined) return rejected("unknown_target");
  if (text.length > TELEGRAM_MAX_MESSAGE_TEXT_CHARS) {
    return rejected(UNDISPATCHABLE_TARGET);
  }

  const claim = deps.claimStore.claim(queryId);
  if (claim.outcome === "duplicate_in_progress") {
    return { httpStatus: 409, body: { status: "duplicate_in_progress" } };
  }
  if (claim.outcome === "already_posted") {
    return { httpStatus: 200, body: { status: "already_posted" } };
  }
  if (claim.outcome === "already_consumed") {
    return { httpStatus: 409, body: { status: "already_consumed" } };
  }

  if (!deps.rateLimiter.hit(String(identity.userId))) {
    // Nothing reached Telegram, so the launch is not spent: release the
    // pending claim rather than burning the query_id on a 429.
    deps.claimStore.release(queryId);
    return { httpStatus: 429, body: { status: "rate_limited" } };
  }

  const result = await answerWebAppQuery(
    {
      queryId,
      text,
      botToken: bot.token,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    deps.fetchImpl,
  );

  if (result.outcome === "posted") {
    deps.claimStore.markPosted(queryId);
    return { httpStatus: 200, body: { status: "posted" } };
  }
  deps.claimStore.markTerminalError(queryId);
  return { httpStatus: 502, body: { status: "telegram_error" } };
}
