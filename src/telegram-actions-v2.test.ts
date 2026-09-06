import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptRunV2Response } from "../shared/pocket-contract";
import {
  isSessionQueryAvailable,
  isTelegramWebAppSupported,
  isTelegramWebAppSupportedV2,
  resetPromptDispatchStateForTests,
  runPrompt,
  sendWebAppQuery,
  sendWebAppQueryV2,
} from "./telegram-actions";

function setTelegramWebApp(overrides: { queryId?: string | null } = {}) {
  window.Telegram = {
    WebApp: {
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      initData: "auth_date=1&hash=abc&query_id=q1&user=%7B%22id%22%3A7%7D",
      initDataUnsafe:
        overrides.queryId === null
          ? { user: { id: 7, first_name: "T" } }
          : {
              query_id: overrides.queryId ?? "q1",
              user: { id: 7, first_name: "T" },
            },
    },
  };
}

const target = { kind: "record", recordId: "01JREC" } as const;

describe("isTelegramWebAppSupportedV2", () => {
  beforeEach(() => resetPromptDispatchStateForTests());
  afterEach(() => {
    delete window.Telegram;
    resetPromptDispatchStateForTests();
  });

  it("needs an API base, a bot key, launch data, and an unspent query_id", () => {
    setTelegramWebApp();
    expect(
      isTelegramWebAppSupportedV2("https://api.example.test", "hermes1"),
    ).toBe(true);
    expect(isTelegramWebAppSupportedV2(undefined, "hermes1")).toBe(false);
    expect(isTelegramWebAppSupportedV2("https://api.example.test", null)).toBe(
      false,
    );
  });

  it("is false without a query_id (unsupported launch surface)", () => {
    setTelegramWebApp({ queryId: null });
    expect(isSessionQueryAvailable()).toBe(false);
    expect(
      isTelegramWebAppSupportedV2("https://api.example.test", "hermes1"),
    ).toBe(false);
  });

  it("does not depend on the v1 endpoint being configured", () => {
    setTelegramWebApp();
    vi.stubEnv("VITE_PROMPT_RUN_ENDPOINT", "");
    expect(isTelegramWebAppSupported()).toBe(false);
    expect(
      isTelegramWebAppSupportedV2("https://api.example.test", "beth"),
    ).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("sendWebAppQueryV2", () => {
  beforeEach(() => {
    resetPromptDispatchStateForTests();
    setTelegramWebApp();
  });
  afterEach(() => {
    delete window.Telegram;
    resetPromptDispatchStateForTests();
  });

  const respond = (body: PromptRunV2Response) =>
    vi.fn().mockResolvedValue(body);

  it("passes the raw initData and target to the transport and reports dispatched on posted", async () => {
    const run = respond({ status: "posted" });
    await expect(sendWebAppQueryV2(target, run)).resolves.toEqual({
      status: "dispatched",
    });
    expect(run).toHaveBeenCalledWith(
      "auth_date=1&hash=abc&query_id=q1&user=%7B%22id%22%3A7%7D",
      target,
    );
    expect(isSessionQueryAvailable()).toBe(false);
  });

  it("treats already_posted as dispatched", async () => {
    await expect(
      sendWebAppQueryV2(target, respond({ status: "already_posted" })),
    ).resolves.toEqual({ status: "dispatched" });
  });

  it.each<[PromptRunV2Response]>([
    [{ status: "rejected", error: "stale_init_data" }],
    [{ status: "rejected", error: "missing_query_id" }],
    [{ status: "duplicate_in_progress" }],
    [{ status: "already_consumed" }],
    [{ status: "telegram_error" }],
  ])(
    "%j: unavailable (reopen helps) and the session is burned",
    async (body) => {
      const run = respond(body);
      await expect(sendWebAppQueryV2(target, run)).resolves.toEqual({
        status: "unavailable",
      });
      expect(isSessionQueryAvailable()).toBe(false);
      await expect(sendWebAppQueryV2(target, run)).rejects.toThrow(/reopen/);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it.each<[PromptRunV2Response, string]>([
    [{ status: "rejected", error: "unknown_bot" }, "unknown_bot"],
    [{ status: "rejected", error: "invalid_request" }, "invalid_request"],
    [{ status: "rejected", error: "invalid_init_data" }, "invalid_init_data"],
    [{ status: "rejected", error: "unknown_target" }, "unknown_target"],
    [{ status: "dispatch_disabled" }, "dispatch_disabled"],
  ])(
    "%j: structural rejection %s leaves the query_id unspent (server rejects before claiming it)",
    async (body, reason) => {
      await expect(sendWebAppQueryV2(target, respond(body))).resolves.toEqual({
        status: "rejected",
        reason,
      });
      // The user can still GO another card in this same session.
      expect(isSessionQueryAvailable()).toBe(true);
      await expect(
        sendWebAppQueryV2(
          { kind: "catalog", cardId: "clear-email" },
          respond({ status: "posted" }),
        ),
      ).resolves.toEqual({ status: "dispatched" });
    },
  );

  it("rate_limited is reported as a structural reason but burns the session (claim precedes the rate check)", async () => {
    await expect(
      sendWebAppQueryV2(target, respond({ status: "rate_limited" })),
    ).resolves.toEqual({ status: "rejected", reason: "rate_limited" });
    expect(isSessionQueryAvailable()).toBe(false);
  });

  it("a transport failure (timeout/network/malformed) is ambiguous: unavailable and burned, never retried", async () => {
    const run = vi.fn().mockRejectedValue(new Error("timed out"));
    await expect(sendWebAppQueryV2(target, run)).resolves.toEqual({
      status: "unavailable",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(isSessionQueryAvailable()).toBe(false);
  });

  it("refuses a concurrent second send without calling the transport", async () => {
    let resolveRun: (value: PromptRunV2Response) => void = () => {};
    const run = vi.fn().mockReturnValue(
      new Promise<PromptRunV2Response>((resolve) => {
        resolveRun = resolve;
      }),
    );
    const first = sendWebAppQueryV2(target, run);
    await expect(sendWebAppQueryV2(target, run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    resolveRun({ status: "posted" });
    await expect(first).resolves.toEqual({ status: "dispatched" });
  });

  it("shares one query_id with the v1 path: a v2 send blocks a later v1 send and vice versa", async () => {
    vi.stubEnv(
      "VITE_PROMPT_RUN_ENDPOINT",
      "https://api.example.test/api/prompt-run",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendWebAppQueryV2(target, respond({ status: "posted" }));
      await expect(sendWebAppQuery("clear-email")).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(isTelegramWebAppSupported()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("throws without launch data instead of sending", async () => {
    delete window.Telegram;
    const run = vi.fn();
    await expect(sendWebAppQueryV2(target, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runPrompt with a v2 adapter", () => {
  const card = { id: "x", prompt: "P" };

  it("returns the adapter's classified outcome verbatim", async () => {
    const result = await runPrompt(card, {
      isInTelegram: () => true,
      supportsOneTapDispatch: () => true,
      sendWebAppQuery: async () => ({
        status: "rejected" as const,
        reason: "unknown_target" as const,
      }),
      copyToClipboard: vi.fn(),
    });
    expect(result).toEqual({ status: "rejected", reason: "unknown_target" });
  });

  it("still treats an undefined resolution (v1 adapter) as dispatched", async () => {
    const result = await runPrompt(card, {
      isInTelegram: () => true,
      supportsOneTapDispatch: () => true,
      sendWebAppQuery: async () => undefined,
      copyToClipboard: vi.fn(),
    });
    expect(result).toEqual({ status: "dispatched" });
  });
});
