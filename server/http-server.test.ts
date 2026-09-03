// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createPromptRunServer } from "./http-server";
import { promptCatalog } from "../shared/prompt-catalog";
import { signInitData } from "./test-helpers/init-data";

const BOT_TOKEN = "test-bot-token";
const originalFetch = globalThis.fetch;

let server: ReturnType<typeof createPromptRunServer>;
let baseUrl: string;

beforeEach(async () => {
  server = createPromptRunServer(BOT_TOKEN);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("createPromptRunServer", () => {
  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("returns a safe 400 for malformed JSON instead of leaking a parser error", async () => {
    const response = await post("/api/prompt-run", "{not json");
    const body = (await response.json()) as { status: string; error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: "rejected", error: "invalid_init_data" });
  });

  it("returns 400 payload_too_large-equivalent safe rejection for an oversized body", async () => {
    const hugeInitData = "x".repeat(20 * 1024);
    const response = await post("/api/prompt-run", {
      cardId: promptCatalog[0].id,
      initData: hugeInitData,
    });
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(400);
    expect(body.status).toBe("rejected");
  });

  it("posts a valid request end to end through real HTTP", async () => {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      return originalFetch(url as never, init);
    }) as typeof fetch;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const initData = signInitData(BOT_TOKEN, {
      query_id: "http-e2e-1",
      user: '{"id":1,"first_name":"Test"}',
      auth_date: String(nowSeconds),
    });

    const response = await post("/api/prompt-run", {
      cardId: promptCatalog[0].id,
      initData,
    });
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "posted" });
  });

  it("answers an allowed-origin CORS preflight without hitting the route handler", async () => {
    const response = await fetch(`${baseUrl}${"/api/prompt-run"}`, {
      method: "OPTIONS",
      headers: {
        origin: "https://m2ai-portfolio.github.io",
        "access-control-request-method": "POST",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://m2ai-portfolio.github.io",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
  });

  it("does not reflect an unrecognized origin in CORS headers", async () => {
    const response = await fetch(`${baseUrl}${"/api/prompt-run"}`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sets the CORS allow-origin header on the real POST response too", async () => {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      return originalFetch(url as never, init);
    }) as typeof fetch;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const initData = signInitData(BOT_TOKEN, {
      query_id: "http-e2e-cors",
      user: '{"id":1,"first_name":"Test"}',
      auth_date: String(nowSeconds),
    });

    const response = await fetch(`${baseUrl}/api/prompt-run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://m2ai-portfolio.github.io",
      },
      body: JSON.stringify({ cardId: promptCatalog[0].id, initData }),
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://m2ai-portfolio.github.io",
    );
  });
});
