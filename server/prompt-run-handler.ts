import { validateInitData } from "./init-data.js";
import { resolveCard } from "./catalog.js";
import { QueryClaimStore } from "./query-claim-store.js";
import { answerWebAppQuery, type FetchLike } from "./telegram-client.js";

export type PromptRunRequestBody = {
  cardId?: unknown;
  initData?: unknown;
};

export type PromptRunResponse =
  | { httpStatus: 200; body: { status: "posted" } }
  | { httpStatus: 200; body: { status: "already_posted" } }
  | {
      httpStatus: 400;
      body: {
        status: "rejected";
        error:
          | "invalid_init_data"
          | "stale_init_data"
          | "missing_query_id"
          | "unknown_card";
      };
    }
  | { httpStatus: 409; body: { status: "duplicate_in_progress" } }
  | { httpStatus: 409; body: { status: "already_consumed" } }
  | { httpStatus: 502; body: { status: "telegram_error" } };

export type PromptRunHandlerDependencies = {
  botToken: string;
  claimStore: QueryClaimStore;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Orchestrates contracts/prompt-run-v1.md end to end: validate, resolve the
 * card from the canonical catalog, atomically claim the query_id, then call
 * Telegram at most once per claim. Never invokes a second LLM: the prompt
 * text posted is the stored catalog text, unmodified.
 */
export async function handlePromptRun(
  request: PromptRunRequestBody,
  deps: PromptRunHandlerDependencies,
): Promise<PromptRunResponse> {
  if (
    typeof request.cardId !== "string" ||
    typeof request.initData !== "string"
  ) {
    return {
      httpStatus: 400,
      body: { status: "rejected", error: "invalid_init_data" },
    };
  }

  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const validation = validateInitData(
    request.initData,
    deps.botToken,
    nowSeconds,
  );
  if (!validation.ok) {
    return {
      httpStatus: 400,
      body: { status: "rejected", error: validation.error },
    };
  }

  const card = resolveCard(request.cardId);
  if (!card) {
    return {
      httpStatus: 400,
      body: { status: "rejected", error: "unknown_card" },
    };
  }

  const claim = deps.claimStore.claim(validation.queryId);
  if (claim.outcome === "duplicate_in_progress") {
    return { httpStatus: 409, body: { status: "duplicate_in_progress" } };
  }
  if (claim.outcome === "already_posted") {
    return { httpStatus: 200, body: { status: "already_posted" } };
  }
  if (claim.outcome === "already_consumed") {
    return { httpStatus: 409, body: { status: "already_consumed" } };
  }

  const result = await answerWebAppQuery(
    {
      queryId: validation.queryId,
      text: card.prompt,
      botToken: deps.botToken,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    deps.fetchImpl,
  );

  if (result.outcome === "posted") {
    deps.claimStore.markPosted(validation.queryId);
    return { httpStatus: 200, body: { status: "posted" } };
  }

  deps.claimStore.markTerminalError(validation.queryId);
  return { httpStatus: 502, body: { status: "telegram_error" } };
}
