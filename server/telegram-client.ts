export type TelegramCallOutcome =
  { outcome: "posted" } | { outcome: "telegram_error" };

export type FetchLike = typeof fetch;

const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_ATTEMPTS = 2;

/**
 * Calls Telegram's answerWebAppQuery. Per contracts/prompt-run-v1.md's
 * single-use / retry boundary: retries only when the failure proves zero
 * request bytes reached Telegram (DNS failure, connection refused). A
 * timeout, socket reset, or any non-2xx response is ambiguous and terminal.
 */
export async function answerWebAppQuery(
  params: {
    queryId: string;
    text: string;
    botToken: string;
    timeoutMs: number;
  },
  fetchImpl: FetchLike = fetch,
): Promise<TelegramCallOutcome> {
  let attempt = 0;
  let lastOutcome: { outcome: "telegram_error"; retryable: boolean } = {
    outcome: "telegram_error",
    retryable: false,
  };

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const result = await attemptCall(params, fetchImpl);
    if (result.outcome === "posted") {
      return result;
    }
    lastOutcome = result;
    if (!result.retryable) {
      break;
    }
  }

  return { outcome: lastOutcome.outcome };
}

async function attemptCall(
  params: {
    queryId: string;
    text: string;
    botToken: string;
    timeoutMs: number;
  },
  fetchImpl: FetchLike,
): Promise<
  { outcome: "posted" } | { outcome: "telegram_error"; retryable: boolean }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetchImpl(
      `${TELEGRAM_API_BASE}/bot${params.botToken}/answerWebAppQuery`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          web_app_query_id: params.queryId,
          result: {
            type: "article",
            id: params.queryId,
            title: "Prompt Pocket",
            input_message_content: { message_text: params.text },
          },
        }),
        signal: controller.signal,
      },
    );

    if (response.ok && (await isTelegramOk(response))) {
      return { outcome: "posted" };
    }

    // A non-2xx, or a 2xx body with `ok: false`, proves Telegram's edge
    // received and attempted the request; it does not prove the query
    // answer did not execute. Ambiguous, terminal.
    return { outcome: "telegram_error", retryable: false };
  } catch (error) {
    if (isAbortError(error)) {
      // Bounded timeout fired with no response: ambiguous, terminal.
      return { outcome: "telegram_error", retryable: false };
    }
    if (isPreSendTransportFailure(error)) {
      return { outcome: "telegram_error", retryable: true };
    }
    return { outcome: "telegram_error", retryable: false };
  } finally {
    clearTimeout(timer);
  }
}

async function isTelegramOk(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    // A 2xx with an unparseable body never proves success; treat as failed.
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isPreSendTransportFailure(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code ?? (error as { code?: string } | undefined)?.code;
  return (
    code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN"
  );
}
