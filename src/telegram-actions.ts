import type {
  DispatchTarget,
  PromptRunV2Response,
} from "../shared/pocket-contract";
import type { PromptCard } from "./types";

/**
 * Structural reasons a send was refused. None of these is cured by closing
 * and reopening Prompt Pocket (contracts/prompt-run-v2.md, "Idempotency,
 * single-use, retry, fallback"), so the UI must not show the "reopen" copy
 * for them. The last three are client-side and never reach the network:
 * `not_synced` means the prompt has no server record yet, so there is
 * nothing a v2 dispatch could target; `invalid_bot_key` means the launch
 * URL's `?bot=` failed the key grammar, which the contract's "Client launch
 * URL" clause defines as "no dispatch"; `no_pocket_server` means the build
 * has a bot key but no v2 API base to send it to.
 */
export type DispatchRejectReason =
  | "unknown_bot"
  | "dispatch_disabled"
  | "invalid_request"
  | "invalid_init_data"
  | "unknown_target"
  | "rate_limited"
  | "not_synced"
  | "invalid_bot_key"
  | "no_pocket_server";

export type DispatchAttempt =
  | { status: "dispatched" }
  /** The session's query_id is spent, or a fresh launch is the remedy. */
  | { status: "unavailable" }
  | { status: "rejected"; reason: DispatchRejectReason };

export type RunPromptDependencies = {
  isInTelegram: () => boolean;
  supportsOneTapDispatch: () => boolean;
  /**
   * Resolving to `undefined` (the v1 adapter) means "dispatched"; a v2
   * adapter resolves to a classified DispatchAttempt instead. A thrown
   * error is always treated as the query_id being spent.
   */
  sendWebAppQuery: (cardId: string) => Promise<void | DispatchAttempt>;
  copyToClipboard: (prompt: string) => Promise<void>;
};

/**
 * The only fields runPrompt() actually needs. Kept narrow (rather than the
 * full PromptCard) so pinned/custom prompts, which never exist in the
 * server-side catalog (contracts/prompt-run-v1.md), can be dispatched
 * through the exact same Telegram-safety gate as catalog cards instead of
 * a bypass path.
 */
export type RunnablePrompt = Pick<PromptCard, "id" | "prompt">;

export type RunPromptResult = DispatchAttempt | { status: "fallback-copied" };

/**
 * One card tap is the whole user action, and the clipboard fallback is a
 * plain-browser-only affordance. Telegram presence and dispatch capability
 * are detected separately: inside Telegram without one-tap dispatch shipped,
 * a tap must surface an honest "unavailable" result asking for a fresh
 * launch, never silently fall back to the clipboard.
 */
export async function runPrompt(
  card: RunnablePrompt,
  dependencies: RunPromptDependencies,
): Promise<RunPromptResult> {
  if (dependencies.supportsOneTapDispatch()) {
    try {
      const outcome = await dependencies.sendWebAppQuery(card.id);
      return outcome ?? { status: "dispatched" };
    } catch {
      // sendWebAppQuery burns the session's single-use query_id on any
      // rejection/timeout/ambiguous outcome, so this is a terminal result,
      // not a caller-side error: surface the fresh-launch recovery status
      // instead of letting the exception reach the UI as a generic retry.
      return { status: "unavailable" };
    }
  }

  if (dependencies.isInTelegram()) {
    return { status: "unavailable" };
  }

  await dependencies.copyToClipboard(card.prompt);
  return { status: "fallback-copied" };
}

/**
 * Read lazily (not cached at module load) so tests can stub the env var
 * per-case; in a real build Vite still inlines this at build time.
 */
function getPromptRunEndpoint(): string | undefined {
  return import.meta.env.VITE_PROMPT_RUN_ENDPOINT;
}

/** contracts/prompt-run-v1.md: "recommend 8s" bounded client-side timeout. */
const REQUEST_TIMEOUT_MS = 8000;

type SessionQueryState = "unused" | "in-flight" | "posted" | "burned";

/**
 * A Telegram Mini App session mints exactly one query_id at launch
 * (contracts/prompt-run-v1.md, "Idempotency key"), and this module is
 * re-instantiated once per page load, i.e. once per session. Tracking the
 * session's dispatch state here means a second attempt for ANY card, not
 * just the one just tapped, is refused locally without a network call: the
 * client must never retry or replay the session's single-use query_id.
 */
let sessionQueryState: SessionQueryState = "unused";

/**
 * The A3 posting adapter (validated Telegram init data -> server-resolved
 * prompt -> Web App query answer) is live. One-tap dispatch is available
 * only when: the page is running inside Telegram with real WebApp launch
 * data (a query_id is present, meaning this is a Menu Button launch, not an
 * unsupported surface), a server endpoint is configured, and this session
 * has not already spent its single-use query_id.
 */
export function isTelegramWebAppSupported(): boolean {
  if (!getPromptRunEndpoint()) {
    return false;
  }
  return isSessionQueryAvailable();
}

/**
 * True when this launch carries signed init data with a query_id AND this
 * page load has not spent it yet. Shared by the v1 and v2 paths: there is
 * exactly one query_id per Mini App session regardless of which route
 * consumes it.
 */
export function isSessionQueryAvailable(): boolean {
  if (sessionQueryState !== "unused") {
    return false;
  }
  const webApp = window.Telegram?.WebApp;
  return Boolean(webApp?.initData) && Boolean(webApp?.initDataUnsafe?.query_id);
}

/**
 * v2 dispatch (contracts/prompt-run-v2.md) needs the same launch conditions
 * as v1 plus a configured API base and a strictly parsed bot key. The key
 * is a request field only; it never changes which server is called.
 */
export function isTelegramWebAppSupportedV2(
  apiBase: string | undefined,
  botKey: string | null,
): boolean {
  if (!apiBase || !botKey) {
    return false;
  }
  return isSessionQueryAvailable();
}

/**
 * Sends `{ cardId, initData }` to the prompt-run-v1 server exactly once per
 * session. Any non-success outcome (rejection, telegram_error, timeout, or
 * transport failure) is ambiguous or terminal per the contract's retry
 * boundary, so it burns the session's query_id here rather than leaving the
 * caller free to try again; a subsequent tap sees
 * `isTelegramWebAppSupported() === false` and surfaces the fallback path
 * instead of replaying the query.
 */
export async function sendWebAppQuery(cardId: string): Promise<void> {
  if (sessionQueryState !== "unused") {
    throw new Error(
      `This Telegram session already used its one-time send; "${cardId}" cannot be dispatched. Close and reopen Prompt Pocket to send another prompt.`,
    );
  }
  const endpoint = getPromptRunEndpoint();
  if (!endpoint) {
    throw new Error("No prompt-run server is configured for this deployment.");
  }

  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) {
    throw new Error("Telegram launch data is unavailable.");
  }

  sessionQueryState = "in-flight";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId, initData }),
      signal: controller.signal,
    });
  } catch (error) {
    sessionQueryState = "burned";
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(
      `Telegram prompt dispatch for "${cardId}" failed (${reason}) and cannot be retried. Close and reopen Prompt Pocket to try again.`,
    );
  } finally {
    clearTimeout(timer);
  }

  let body: { status?: string } = {};
  try {
    body = (await response.json()) as { status?: string };
  } catch {
    // Malformed body: fall through and treat as a failed dispatch below.
  }

  if (
    response.status === 200 &&
    (body.status === "posted" || body.status === "already_posted")
  ) {
    sessionQueryState = "posted";
    return;
  }

  sessionQueryState = "burned";
  throw new Error(
    `Telegram prompt dispatch for "${cardId}" was not confirmed (${body.status ?? response.status}) and cannot be retried. Close and reopen Prompt Pocket to try again.`,
  );
}

/**
 * v2 counterpart of sendWebAppQuery: one `prompt-run/v2` request per
 * session, targeting either a catalog card or one of the user's own pocket
 * records. `run` is the transport (pocket-client's promptRunV2) so this
 * module owns only the single-use bookkeeping and the outcome classing.
 *
 * Classification follows the server's validation order
 * (contracts/prompt-run-v2.md): schema, kill switch, bot key, init data,
 * and target are all checked BEFORE the query_id is claimed, so those
 * rejections leave the session's query_id unspent and this module keeps
 * it `unused` (the user can still GO another card). Everything at or after
 * the claim (rate limit, duplicate, consumed, Telegram error) and every
 * transport failure is ambiguous or terminal and burns the session.
 * `stale_init_data` / `missing_query_id` are pre-claim, but only a fresh
 * launch can fix them, so they are reported as `unavailable` too.
 */
export async function sendWebAppQueryV2(
  target: DispatchTarget,
  run: (
    initData: string,
    target: DispatchTarget,
  ) => Promise<PromptRunV2Response>,
): Promise<DispatchAttempt> {
  if (sessionQueryState !== "unused") {
    throw new Error(
      "This Telegram session already used its one-time send. Close and reopen Prompt Pocket to send another prompt.",
    );
  }
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) {
    throw new Error("Telegram launch data is unavailable.");
  }

  sessionQueryState = "in-flight";

  let response: PromptRunV2Response;
  try {
    response = await run(initData, target);
  } catch {
    // Timeout, network, or malformed body: the server may have already
    // posted, so this is terminal for the session's query_id.
    sessionQueryState = "burned";
    return { status: "unavailable" };
  }

  switch (response.status) {
    case "posted":
    case "already_posted":
      sessionQueryState = "posted";
      return { status: "dispatched" };
    case "rejected":
      switch (response.error) {
        case "stale_init_data":
        case "missing_query_id":
          sessionQueryState = "burned";
          return { status: "unavailable" };
        default:
          sessionQueryState = "unused";
          return { status: "rejected", reason: response.error };
      }
    case "dispatch_disabled":
      sessionQueryState = "unused";
      return { status: "rejected", reason: "dispatch_disabled" };
    case "rate_limited":
      sessionQueryState = "burned";
      return { status: "rejected", reason: "rate_limited" };
    case "duplicate_in_progress":
    case "already_consumed":
    case "telegram_error":
      sessionQueryState = "burned";
      return { status: "unavailable" };
  }
}

/**
 * Test-only: resets the module-level session state between test cases. Not
 * used by production code paths.
 */
export function resetPromptDispatchStateForTests(): void {
  sessionQueryState = "unused";
}

export async function copyPromptToClipboard(prompt: string): Promise<void> {
  await navigator.clipboard.writeText(prompt);
}
