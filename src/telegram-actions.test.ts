import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTelegramWebAppSupported,
  resetPromptDispatchStateForTests,
  runPrompt,
  sendWebAppQuery,
} from "./telegram-actions";
import type { PromptCard } from "./types";

const card: PromptCard = {
  id: "clear-email",
  kind: "prompt",
  title: "Write a clear email",
  description: "Turn rough notes into a polished email.",
  category: "Writing",
  tags: ["email"],
  prompt: "Help me write a clear email.",
  action: {
    type: "prompt-delivery",
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

describe("runPrompt", () => {
  it("dispatches the card exactly once with no confirmation step when one-tap dispatch is supported", async () => {
    const sendWebAppQuery = vi.fn().mockResolvedValue(undefined);
    const copyToClipboard = vi.fn();

    const result = await runPrompt(card, {
      isInTelegram: () => true,
      supportsOneTapDispatch: () => true,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "dispatched" });
    expect(sendWebAppQuery).toHaveBeenCalledTimes(1);
    expect(sendWebAppQuery).toHaveBeenCalledWith(card.id);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("falls back to an explicit clipboard copy exactly once in a plain-browser context", async () => {
    const sendWebAppQuery = vi.fn();
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);

    const result = await runPrompt(card, {
      isInTelegram: () => false,
      supportsOneTapDispatch: () => false,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "fallback-copied" });
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(card.prompt);
    expect(sendWebAppQuery).not.toHaveBeenCalled();
  });

  it("never uses the clipboard fallback inside Telegram when one-tap dispatch is unavailable", async () => {
    const sendWebAppQuery = vi.fn();
    const copyToClipboard = vi.fn();

    const result = await runPrompt(card, {
      isInTelegram: () => true,
      supportsOneTapDispatch: () => false,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(sendWebAppQuery).not.toHaveBeenCalled();
  });

  it("resolves to unavailable, not a thrown error, after exactly one failed send attempt (rejection/timeout/ambiguous)", async () => {
    const sendWebAppQuery = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Telegram prompt dispatch for "clear-email" was not confirmed (rejected) and cannot be retried. Close and reopen Prompt Pocket to try again.',
        ),
      );
    const copyToClipboard = vi.fn();

    const result = await runPrompt(card, {
      isInTelegram: () => true,
      supportsOneTapDispatch: () => true,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(sendWebAppQuery).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });
});

function setTelegramWebApp(
  overrides: {
    initData?: string;
    queryId?: string;
  } = {},
): void {
  window.Telegram = {
    WebApp: {
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      initData: overrides.initData ?? "auth_date=1&hash=abc&query_id=q1",
      initDataUnsafe: {
        query_id: overrides.queryId ?? "q1",
      },
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isTelegramWebAppSupported / sendWebAppQuery (A3 integration)", () => {
  beforeEach(() => {
    resetPromptDispatchStateForTests();
    vi.stubEnv(
      "VITE_PROMPT_RUN_ENDPOINT",
      "https://api.example.test/api/prompt-run",
    );
  });

  afterEach(() => {
    delete (window as { Telegram?: unknown }).Telegram;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetPromptDispatchStateForTests();
  });

  it("is supported only when Telegram launch data, a query_id, and a configured endpoint are all present", () => {
    setTelegramWebApp();
    expect(isTelegramWebAppSupported()).toBe(true);
  });

  it("is unsupported outside Telegram (no window.Telegram)", () => {
    expect(isTelegramWebAppSupported()).toBe(false);
  });

  it("is unsupported when Telegram is present but the launch carries no query_id (unsupported launch surface)", () => {
    window.Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
        initData: "auth_date=1&hash=abc",
        initDataUnsafe: {},
      },
    };
    expect(isTelegramWebAppSupported()).toBe(false);
  });

  it("is unsupported when no server endpoint is configured", () => {
    vi.unstubAllEnvs();
    setTelegramWebApp();
    expect(isTelegramWebAppSupported()).toBe(false);
  });

  it("posts { cardId, initData } to the configured endpoint and resolves on status=posted", async () => {
    setTelegramWebApp({ initData: "auth_date=1&hash=abc&query_id=q1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "posted" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWebAppQuery("clear-email")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/prompt-run");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      cardId: "clear-email",
      initData: "auth_date=1&hash=abc&query_id=q1",
    });
  });

  it("treats already_posted as a resolved dispatch (server-side idempotent replay of the same claim)", async () => {
    setTelegramWebApp();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { status: "already_posted" })),
    );

    await expect(sendWebAppQuery("clear-email")).resolves.toBeUndefined();
  });

  it("throws and never retries after a server rejection (e.g. missing_query_id)", async () => {
    setTelegramWebApp();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { status: "rejected", error: "missing_query_id" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWebAppQuery("clear-email")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Single-use: a second attempt for any card must not touch the network.
    await expect(sendWebAppQuery("another-card")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isTelegramWebAppSupported()).toBe(false);
  });

  it("aborts after the bounded timeout and burns the session without retrying", async () => {
    vi.useFakeTimers();
    setTelegramWebApp();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = sendWebAppQuery("clear-email");
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isTelegramWebAppSupported()).toBe(false);

    vi.useRealTimers();
  });

  it("suppresses a concurrent duplicate dispatch without a second network call", async () => {
    setTelegramWebApp();
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = sendWebAppQuery("clear-email");
    // Same session's query_id is already in flight for a different card tap.
    await expect(sendWebAppQuery("another-card")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(200, { status: "posted" }));
    await expect(first).resolves.toBeUndefined();
  });
});
