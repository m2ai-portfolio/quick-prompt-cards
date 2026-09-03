// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handlePromptRun } from "./prompt-run-handler";
import { QueryClaimStore } from "./query-claim-store";
import { promptCatalog } from "../shared/prompt-catalog";
import { signInitData } from "./test-helpers/init-data";
import type { FetchLike } from "./telegram-client";

const BOT_TOKEN = "test-bot-token";
const NOW_MS = 1_800_000_000_000;
const KNOWN_CARD_ID = promptCatalog[0].id;

function validRequest(overrides: Record<string, string> = {}) {
  const fields = {
    query_id: "query-1",
    user: '{"id":1,"first_name":"Test"}',
    auth_date: String(Math.floor(NOW_MS / 1000)),
    ...overrides,
  };
  return {
    cardId: KNOWN_CARD_ID,
    initData: signInitData(BOT_TOKEN, fields),
  };
}

function telegramOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
  });
}

function successFetch(): FetchLike {
  return vi.fn(async () => telegramOkResponse()) as unknown as FetchLike;
}

function deps(overrides: Partial<Parameters<typeof handlePromptRun>[1]> = {}) {
  return {
    botToken: BOT_TOKEN,
    claimStore: new QueryClaimStore(),
    now: () => NOW_MS,
    fetchImpl: successFetch(),
    ...overrides,
  };
}

describe("handlePromptRun", () => {
  it("posts the stored prompt for a valid request and never sends client-supplied text", async () => {
    let capturedBody = "";
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return telegramOkResponse();
    }) as unknown as FetchLike;

    const result = await handlePromptRun(validRequest(), deps({ fetchImpl }));

    expect(result).toEqual({ httpStatus: 200, body: { status: "posted" } });
    const parsed = JSON.parse(capturedBody);
    expect(parsed.result.input_message_content.message_text).toBe(
      promptCatalog[0].prompt,
    );
  });

  it("rejects a bad signature", async () => {
    const request = validRequest();
    const tampered = {
      ...request,
      initData: request.initData.replace(/hash=[^&]+/, "hash=deadbeef"),
    };

    const result = await handlePromptRun(tampered, deps());

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "invalid_init_data" },
    });
  });

  it("rejects a stale auth_date", async () => {
    const staleSeconds = Math.floor(NOW_MS / 1000) - 5 * 60 - 30;
    const request = validRequest({ auth_date: String(staleSeconds) });

    const result = await handlePromptRun(request, deps());

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "stale_init_data" },
    });
  });

  it("rejects an unknown card id", async () => {
    const request = { ...validRequest(), cardId: "not-a-real-card" };

    const result = await handlePromptRun(request, deps());

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "unknown_card" },
    });
  });

  it("returns duplicate_in_progress for a second concurrent call with the same query_id", async () => {
    const claimStore = new QueryClaimStore();
    let resolveFirstFetch!: (value: Response) => void;
    const firstFetch: FetchLike = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirstFetch = resolve;
        }),
    ) as unknown as FetchLike;

    const request = validRequest();
    const firstCall = handlePromptRun(
      request,
      deps({ claimStore, fetchImpl: firstFetch }),
    );

    // Let the first call's synchronous claim() run before the second starts.
    await Promise.resolve();

    const secondResult = await handlePromptRun(
      request,
      deps({ claimStore, fetchImpl: successFetch() }),
    );

    expect(secondResult).toEqual({
      httpStatus: 409,
      body: { status: "duplicate_in_progress" },
    });

    resolveFirstFetch(telegramOkResponse());
    const firstResult = await firstCall;
    expect(firstResult).toEqual({
      httpStatus: 200,
      body: { status: "posted" },
    });
  });

  it("returns already_posted for a repeat call after the claim reached posted", async () => {
    const claimStore = new QueryClaimStore();
    const request = validRequest();

    await handlePromptRun(request, deps({ claimStore }));
    const secondResult = await handlePromptRun(request, deps({ claimStore }));

    expect(secondResult).toEqual({
      httpStatus: 200,
      body: { status: "already_posted" },
    });
  });

  it("surfaces telegram_error on a Telegram failure and marks the claim consumed", async () => {
    const claimStore = new QueryClaimStore();
    const request = validRequest();
    const failingFetch: FetchLike = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as FetchLike;

    const result = await handlePromptRun(
      request,
      deps({ claimStore, fetchImpl: failingFetch }),
    );

    expect(result).toEqual({
      httpStatus: 502,
      body: { status: "telegram_error" },
    });

    const secondResult = await handlePromptRun(
      request,
      deps({ claimStore, fetchImpl: successFetch() }),
    );
    expect(secondResult).toEqual({
      httpStatus: 409,
      body: { status: "already_consumed" },
    });
  });

  it("respects the bounded timeout and returns telegram_error rather than hanging", async () => {
    const request = validRequest();
    const hangingFetch: FetchLike = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as FetchLike;

    const start = Date.now();
    const result = await handlePromptRun(
      request,
      deps({ fetchImpl: hangingFetch, timeoutMs: 30 }),
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({
      httpStatus: 502,
      body: { status: "telegram_error" },
    });
    expect(elapsed).toBeLessThan(500);
  });

  it("returns a safe rejected body with no raw initData, hash, or stack trace", async () => {
    const request = validRequest();
    const tampered = {
      ...request,
      initData: request.initData.replace(/hash=[^&]+/, "hash=deadbeef"),
    };

    const result = await handlePromptRun(tampered, deps());

    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain(tampered.initData);
    expect(serialized).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack-trace-like content
    expect(Object.keys(result.body)).toEqual(
      expect.arrayContaining(["status"]),
    );
  });

  it("rejects a non-string cardId or initData without throwing", async () => {
    const result = await handlePromptRun(
      { cardId: 123, initData: null },
      deps(),
    );

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "invalid_init_data" },
    });
  });
});
