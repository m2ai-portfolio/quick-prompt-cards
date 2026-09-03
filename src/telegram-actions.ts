import type { PromptCard } from "./types";

export type RunPromptDependencies = {
  isInTelegram: () => boolean;
  supportsOneTapDispatch: () => boolean;
  sendWebAppQuery: (cardId: string) => Promise<void>;
  copyToClipboard: (prompt: string) => Promise<void>;
};

export type RunPromptResult =
  | { status: "dispatched" }
  | { status: "fallback-copied" }
  | { status: "unavailable" };

/**
 * One card tap is the whole user action, and the clipboard fallback is a
 * plain-browser-only affordance. Telegram presence and dispatch capability
 * are detected separately: inside Telegram without one-tap dispatch shipped,
 * a tap must surface an honest "unavailable" result asking for a fresh
 * launch, never silently fall back to the clipboard.
 */
export async function runPrompt(
  card: PromptCard,
  dependencies: RunPromptDependencies,
): Promise<RunPromptResult> {
  if (dependencies.supportsOneTapDispatch()) {
    try {
      await dependencies.sendWebAppQuery(card.id);
      return { status: "dispatched" };
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
  if (sessionQueryState !== "unused") {
    return false;
  }
  if (!getPromptRunEndpoint()) {
    return false;
  }
  const webApp = window.Telegram?.WebApp;
  return Boolean(webApp?.initData) && Boolean(webApp?.initDataUnsafe?.query_id);
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
 * Test-only: resets the module-level session state between test cases. Not
 * used by production code paths.
 */
export function resetPromptDispatchStateForTests(): void {
  sessionQueryState = "unused";
}

export async function copyPromptToClipboard(prompt: string): Promise<void> {
  await navigator.clipboard.writeText(prompt);
}
