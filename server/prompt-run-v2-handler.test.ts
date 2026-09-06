// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePromptRunV2 } from "./prompt-run-v2-handler";
import { loadBotRegistry } from "./bot-registry";
import { PocketStore } from "./pocket-store";
import { QueryClaimStore } from "./query-claim-store";
import { SlidingWindowRateLimiter } from "./rate-limit";
import { promptCatalog } from "../shared/prompt-catalog";
import { signInitData } from "./test-helpers/init-data";
import type { FetchLike } from "./telegram-client";

const NOW_MS = 1_800_000_000_000;
const HERMES_TOKEN = "fake-token-hermes1";
const BETH_TOKEN = "fake-token-beth";
const USER_A = 1001;
const USER_B = 2002;

const ENV = {
  PROMPT_POCKET_BOTS: "hermes1,beth",
  PROMPT_POCKET_BOT_HERMES1_TOKEN: HERMES_TOKEN,
  PROMPT_POCKET_BOT_BETH_TOKEN: BETH_TOKEN,
};

let store: PocketStore;

beforeEach(() => {
  store = PocketStore.inMemory();
});

afterEach(() => {
  store.close();
});

function telegramOk(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
  });
}

function captureFetch(): {
  fetchImpl: FetchLike;
  calls: { url: string; body: string }[];
} {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return telegramOk();
    },
  ) as unknown as FetchLike;
  return { fetchImpl, calls };
}

function initDataFor(
  token: string,
  userId: number,
  overrides: Record<string, string> = {},
): string {
  return signInitData(token, {
    query_id: `q-${userId}-${Math.random().toString(36).slice(2)}`,
    user: JSON.stringify({ id: userId, first_name: "Test" }),
    auth_date: String(Math.floor(NOW_MS / 1000)),
    ...overrides,
  });
}

function deps(
  overrides: Partial<Parameters<typeof handlePromptRunV2>[1]> = {},
) {
  const { fetchImpl } = captureFetch();
  return {
    registry: loadBotRegistry(ENV),
    store,
    claimStore: new QueryClaimStore(),
    rateLimiter: new SlidingWindowRateLimiter({
      limit: 30,
      windowMs: 10 * 60 * 1000,
      clock: () => NOW_MS,
    }),
    now: () => NOW_MS,
    fetchImpl,
    ...overrides,
  };
}

const catalogTarget = { kind: "catalog" as const, cardId: promptCatalog[0].id };

describe("handlePromptRunV2 happy paths", () => {
  it("posts a catalog card with the launching bot's token", async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: catalogTarget,
      },
      deps({ fetchImpl }),
    );

    expect(result).toEqual({ httpStatus: 200, body: { status: "posted" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/bot${HERMES_TOKEN}/answerWebAppQuery`);
    expect(calls[0].url).not.toContain(BETH_TOKEN);
    expect(
      JSON.parse(calls[0].body).result.input_message_content.message_text,
    ).toBe(promptCatalog[0].prompt);
  });

  it("posts the user's own record text via the second bot's token", async () => {
    const record = store.insertRecord(
      USER_A,
      {
        source: "personal",
        canonicalCardId: null,
        title: "Mine",
        category: "",
        prompt: "My own words.",
        hidden: false,
      },
      new Date(NOW_MS).toISOString(),
    );
    const { fetchImpl, calls } = captureFetch();

    const result = await handlePromptRunV2(
      {
        botKey: "beth",
        initData: initDataFor(BETH_TOKEN, USER_A),
        target: { kind: "record", recordId: record.id },
      },
      deps({ fetchImpl }),
    );

    expect(result).toEqual({ httpStatus: 200, body: { status: "posted" } });
    expect(calls[0].url).toContain(`/bot${BETH_TOKEN}/`);
    expect(
      JSON.parse(calls[0].body).result.input_message_content.message_text,
    ).toBe("My own words.");
  });

  it("posts a canonical-override record's OWN text, not the catalog text", async () => {
    const record = store.insertRecord(
      USER_A,
      {
        source: "canonical-override",
        canonicalCardId: promptCatalog[0].id,
        title: "Edited",
        category: "Writing",
        prompt: "Edited version of the starter card.",
        hidden: false,
      },
      new Date(NOW_MS).toISOString(),
    );
    const { fetchImpl, calls } = captureFetch();

    await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "record", recordId: record.id },
      },
      deps({ fetchImpl }),
    );

    expect(
      JSON.parse(calls[0].body).result.input_message_content.message_text,
    ).toBe("Edited version of the starter card.");
  });
});

describe("handlePromptRunV2 validation order and adversarial cases", () => {
  it("rejects a schema violation before anything else: extra fields, missing fields, bad target", async () => {
    const { fetchImpl, calls } = captureFetch();
    const base = {
      botKey: "hermes1",
      initData: initDataFor(HERMES_TOKEN, USER_A),
      target: catalogTarget,
    };
    const bad: unknown[] = [
      { ...base, token: "x" },
      { ...base, text: "inject me" },
      { ...base, ownerId: USER_B },
      { ...base, chatId: 5 },
      { botKey: "hermes1", initData: base.initData },
      { ...base, target: { kind: "catalog", cardId: "x", text: "y" } },
      { ...base, target: { kind: "record" } },
      { ...base, target: { kind: "chat", cardId: "x" } },
      { ...base, target: "clear-email" },
      { ...base, botKey: 5 },
      { ...base, initData: 5 },
      null,
      "string",
      [],
    ];

    for (const body of bad) {
      const result = await handlePromptRunV2(body, deps({ fetchImpl }));
      expect(result).toEqual({
        httpStatus: 400,
        body: { status: "rejected", error: "invalid_request" },
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("returns dispatch_disabled before touching the registry or Telegram", async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: catalogTarget,
      },
      deps({
        fetchImpl,
        registry: loadBotRegistry({
          ...ENV,
          PROMPT_POCKET_DISPATCH_DISABLED: "1",
        }),
      }),
    );

    expect(result).toEqual({
      httpStatus: 503,
      body: { status: "dispatch_disabled" },
    });
    expect(calls).toHaveLength(0);
  });

  it("returns unknown_bot for unknown, disabled, and malformed keys, zero Telegram calls", async () => {
    const { fetchImpl, calls } = captureFetch();
    const registry = loadBotRegistry({ ...ENV, PROMPT_POCKET_BOTS: "hermes1" });

    for (const botKey of ["nobody", "beth", "Hermes1", "hermes1 ", "a", ""]) {
      const result = await handlePromptRunV2(
        {
          botKey,
          initData: initDataFor(BETH_TOKEN, USER_A),
          target: catalogTarget,
        },
        deps({ fetchImpl, registry }),
      );
      expect(result).toEqual({
        httpStatus: 400,
        body: { status: "rejected", error: "unknown_bot" },
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("removing beth from the list leaves hermes1 unaffected", async () => {
    const { fetchImpl, calls } = captureFetch();
    const registry = loadBotRegistry({ ...ENV, PROMPT_POCKET_BOTS: "hermes1" });

    const result = await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: catalogTarget,
      },
      deps({ fetchImpl, registry }),
    );
    expect(result).toEqual({ httpStatus: 200, body: { status: "posted" } });
    expect(calls).toHaveLength(1);
  });

  it("rejects Bot A's signature sent with Bot B's key as invalid_init_data", async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await handlePromptRunV2(
      {
        botKey: "beth",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: catalogTarget,
      },
      deps({ fetchImpl }),
    );

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "invalid_init_data" },
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects forged, stale, missing query_id, and missing/non-numeric user initData", async () => {
    const { fetchImpl, calls } = captureFetch();
    const good = initDataFor(HERMES_TOKEN, USER_A);
    const cases: [string, string][] = [
      [good.replace(/hash=[^&]+/, "hash=deadbeef"), "invalid_init_data"],
      [
        initDataFor(HERMES_TOKEN, USER_A, {
          auth_date: String(Math.floor(NOW_MS / 1000) - 5 * 60 - 30),
        }),
        "stale_init_data",
      ],
      [
        signInitData(HERMES_TOKEN, {
          user: JSON.stringify({ id: USER_A }),
          auth_date: String(Math.floor(NOW_MS / 1000)),
        }),
        "missing_query_id",
      ],
      [
        signInitData(HERMES_TOKEN, {
          query_id: "q",
          auth_date: String(Math.floor(NOW_MS / 1000)),
        }),
        "invalid_init_data",
      ],
      [
        signInitData(HERMES_TOKEN, {
          query_id: "q",
          user: JSON.stringify({ id: "1001" }),
          auth_date: String(Math.floor(NOW_MS / 1000)),
        }),
        "invalid_init_data",
      ],
      [
        signInitData(HERMES_TOKEN, {
          query_id: "q",
          user: "not-json",
          auth_date: String(Math.floor(NOW_MS / 1000)),
        }),
        "invalid_init_data",
      ],
      ["", "invalid_init_data"],
    ];

    for (const [initData, error] of cases) {
      const result = await handlePromptRunV2(
        { botKey: "hermes1", initData, target: catalogTarget },
        deps({ fetchImpl }),
      );
      expect(result).toEqual({
        httpStatus: 400,
        body: { status: "rejected", error },
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("returns unknown_target for an unknown catalog card", async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "catalog", cardId: "not-a-card" },
      },
      deps({ fetchImpl }),
    );
    expect(result).toEqual({
      httpStatus: 400,
      body: { status: "rejected", error: "unknown_target" },
    });
    expect(calls).toHaveLength(0);
  });

  it("returns unknown_target for another user's record, a soft-deleted record, and a missing record, identically", async () => {
    const record = store.insertRecord(
      USER_B,
      {
        source: "personal",
        canonicalCardId: null,
        title: "B's",
        category: "",
        prompt: "B's secret prompt",
        hidden: false,
      },
      new Date(NOW_MS).toISOString(),
    );
    const deleted = store.insertRecord(
      USER_A,
      {
        source: "personal",
        canonicalCardId: null,
        title: "gone",
        category: "",
        prompt: "gone",
        hidden: false,
      },
      new Date(NOW_MS).toISOString(),
    );
    store.softDeleteRecord(USER_A, deleted.id, new Date(NOW_MS).toISOString());
    const { fetchImpl, calls } = captureFetch();

    const results = await Promise.all(
      [record.id, deleted.id, "01ARZ3NDEKTSV4RRFFQ69G5FAV"].map((recordId) =>
        handlePromptRunV2(
          {
            botKey: "hermes1",
            initData: initDataFor(HERMES_TOKEN, USER_A),
            target: { kind: "record", recordId },
          },
          deps({ fetchImpl }),
        ),
      ),
    );

    for (const result of results) {
      expect(result).toEqual({
        httpStatus: 400,
        body: { status: "rejected", error: "unknown_target" },
      });
    }
    expect(JSON.stringify(results)).not.toContain("secret");
    expect(calls).toHaveLength(0);
  });

  it("claims the query_id: replay returns already_posted and calls Telegram once", async () => {
    const { fetchImpl, calls } = captureFetch();
    const shared = deps({ fetchImpl });
    const request = {
      botKey: "hermes1",
      initData: initDataFor(HERMES_TOKEN, USER_A),
      target: catalogTarget,
    };

    const first = await handlePromptRunV2(request, shared);
    const second = await handlePromptRunV2(request, shared);

    expect(first).toEqual({ httpStatus: 200, body: { status: "posted" } });
    expect(second).toEqual({
      httpStatus: 200,
      body: { status: "already_posted" },
    });
    expect(calls).toHaveLength(1);
  });

  it("marks the claim consumed after a Telegram failure", async () => {
    const failing = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as FetchLike;
    const shared = deps({ fetchImpl: failing });
    const request = {
      botKey: "hermes1",
      initData: initDataFor(HERMES_TOKEN, USER_A),
      target: catalogTarget,
    };

    expect(await handlePromptRunV2(request, shared)).toEqual({
      httpStatus: 502,
      body: { status: "telegram_error" },
    });
    expect(await handlePromptRunV2(request, shared)).toEqual({
      httpStatus: 409,
      body: { status: "already_consumed" },
    });
  });

  it("rate limits at 30 dispatches per user per 10 minutes across bots, and does not burn the query_id", async () => {
    const { fetchImpl, calls } = captureFetch();
    const shared = deps({ fetchImpl });

    for (let i = 0; i < 30; i += 1) {
      const botKey = i % 2 === 0 ? "hermes1" : "beth";
      const token = botKey === "hermes1" ? HERMES_TOKEN : BETH_TOKEN;
      const result = await handlePromptRunV2(
        { botKey, initData: initDataFor(token, USER_A), target: catalogTarget },
        shared,
      );
      expect(result.httpStatus).toBe(200);
    }

    const limitedInitData = initDataFor(HERMES_TOKEN, USER_A);
    const limited = await handlePromptRunV2(
      { botKey: "hermes1", initData: limitedInitData, target: catalogTarget },
      shared,
    );
    expect(limited).toEqual({
      httpStatus: 429,
      body: { status: "rate_limited" },
    });
    expect(calls).toHaveLength(30);

    // A different user is unaffected.
    const other = await handlePromptRunV2(
      {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_B),
        target: catalogTarget,
      },
      shared,
    );
    expect(other.httpStatus).toBe(200);

    // The rate-limited query_id was released, not burned: once the window
    // moves on the same launch can still post.
    const later = deps({
      fetchImpl,
      claimStore: shared.claimStore,
      rateLimiter: new SlidingWindowRateLimiter({
        limit: 30,
        windowMs: 10 * 60 * 1000,
        clock: () => NOW_MS + 11 * 60 * 1000,
      }),
    });
    const retry = await handlePromptRunV2(
      { botKey: "hermes1", initData: limitedInitData, target: catalogTarget },
      later,
    );
    expect(retry).toEqual({ httpStatus: 200, body: { status: "posted" } });
  });

  it("never echoes initData, hash, query_id, user id, or prompt text in a response", async () => {
    const initData = initDataFor(HERMES_TOKEN, USER_A);
    const result = await handlePromptRunV2(
      { botKey: "hermes1", initData, target: catalogTarget },
      deps(),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(String(USER_A));
    expect(serialized).not.toContain("query_id");
    expect(serialized).not.toContain(promptCatalog[0].prompt.slice(0, 20));
    expect(serialized).not.toContain(HERMES_TOKEN);
  });
});
