// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { answerWebAppQuery, type FetchLike } from "./telegram-client";

const baseParams = {
  queryId: "q1",
  text: "hello",
  botToken: "test-token",
  timeoutMs: 200,
};

function dnsFailure(): Error {
  const error = new Error("getaddrinfo ENOTFOUND api.telegram.org");
  (error as unknown as { cause: { code: string } }).cause = {
    code: "ENOTFOUND",
  };
  return error;
}

function connectionRefused(): Error {
  const error = new Error("connect ECONNREFUSED");
  (error as unknown as { cause: { code: string } }).cause = {
    code: "ECONNREFUSED",
  };
  return error;
}

function telegramOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
  });
}

describe("answerWebAppQuery", () => {
  it("returns posted on a successful call", async () => {
    const fetchImpl: FetchLike = vi.fn(
      async () => telegramOkResponse(),
    ) as unknown as FetchLike;

    const result = await answerWebAppQuery(baseParams, fetchImpl);

    expect(result).toEqual({ outcome: "posted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the query_id and prompt text in the request body, never the bot token in the body", async () => {
    let capturedBody = "";
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return telegramOkResponse();
    }) as unknown as FetchLike;

    await answerWebAppQuery(baseParams, fetchImpl);

    const parsed = JSON.parse(capturedBody);
    expect(parsed.web_app_query_id).toBe("q1");
    expect(parsed.result.input_message_content.message_text).toBe("hello");
    expect(capturedBody).not.toContain("test-token");
  });

  it("retries once on a pre-send DNS failure, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(dnsFailure())
      .mockResolvedValueOnce(telegramOkResponse());

    const result = await answerWebAppQuery(
      baseParams,
      fetchImpl as unknown as FetchLike,
    );

    expect(result).toEqual({ outcome: "posted" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once on connection refused, then returns telegram_error if it persists", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(connectionRefused())
      .mockRejectedValueOnce(connectionRefused());

    const result = await answerWebAppQuery(
      baseParams,
      fetchImpl as unknown as FetchLike,
    );

    expect(result).toEqual({ outcome: "telegram_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry and does not report posted for a 2xx response with ok: false", async () => {
    const fetchImpl: FetchLike = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "query is too old" }),
          { status: 200 },
        ),
    ) as unknown as FetchLike;

    const result = await answerWebAppQuery(baseParams, fetchImpl);

    expect(result).toEqual({ outcome: "telegram_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-2xx response (ambiguous, ~request may have landed)", async () => {
    const fetchImpl: FetchLike = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as FetchLike;

    const result = await answerWebAppQuery(baseParams, fetchImpl);

    expect(result).toEqual({ outcome: "telegram_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a timeout (ambiguous: response may have been in flight)", async () => {
    const fetchImpl: FetchLike = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as FetchLike;

    const start = Date.now();
    const result = await answerWebAppQuery(
      { ...baseParams, timeoutMs: 30 },
      fetchImpl,
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({ outcome: "telegram_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(500);
  });
});
