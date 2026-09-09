// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createAppServer, type RequestLogLine } from "./http-server";
import { loadBotRegistry } from "./bot-registry";
import { PocketStore } from "./pocket-store";
import { SlidingWindowRateLimiter } from "./rate-limit";
import { promptCatalog } from "../shared/prompt-catalog";
import {
  POCKET_LIMITS,
  POCKET_ROUTES,
  type ExportResponse,
  type ImportResponse,
  type PocketListResponse,
  type PromptRecord,
} from "../shared/pocket-contract";
import { signInitData } from "./test-helpers/init-data";
import type { FetchLike } from "./telegram-client";

const V1_TOKEN = "fake-v1-token";
const HERMES_TOKEN = "fake-token-hermes1";
const BETH_TOKEN = "fake-token-beth";
const USER_A = 1001;
const USER_B = 2002;
const ORIGIN = "https://m2ai-portfolio.github.io";
const NOW_MS = 1_800_000_000_000;

const ENV = {
  PROMPT_POCKET_BOTS: "hermes1,beth",
  PROMPT_POCKET_BOT_HERMES1_TOKEN: HERMES_TOKEN,
  PROMPT_POCKET_BOT_HERMES1_USERNAME: "m2ai_hermes1_bot",
  PROMPT_POCKET_BOT_BETH_TOKEN: BETH_TOKEN,
};

const originalFetch = globalThis.fetch;

let store: PocketStore;
let server: ReturnType<typeof createAppServer>;
let baseUrl: string;
let now: number;
let telegramCalls: { url: string; body: string }[];
let logLines: RequestLogLine[];
let pocketRateLimiter: SlidingWindowRateLimiter;

async function startServer(
  overrides: Partial<Parameters<typeof createAppServer>[0]> = {},
  envOverrides: Partial<typeof ENV> & Record<string, string> = {},
) {
  server = createAppServer({
    v1BotToken: V1_TOKEN,
    pocket: {
      registry: loadBotRegistry({ ...ENV, ...envOverrides }),
      store,
      now: () => now,
      fetchImpl: telegramFetch,
      pocketRateLimiter,
    },
    log: (line) => logLines.push(line),
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

const telegramFetch = (async (
  url: string | URL | Request,
  init?: RequestInit,
) => {
  telegramCalls.push({ url: String(url), body: String(init?.body ?? "") });
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
  });
}) as unknown as FetchLike;

beforeEach(async () => {
  store = PocketStore.inMemory();
  now = NOW_MS;
  telegramCalls = [];
  logLines = [];
  pocketRateLimiter = new SlidingWindowRateLimiter({
    limit: 120,
    windowMs: 10 * 60 * 1000,
    clock: () => now,
  });
  await startServer();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});

function initDataFor(
  token: string,
  userId: number,
  extra: Record<string, string> = {},
): string {
  return signInitData(token, {
    query_id: `q-${userId}-${Math.random().toString(36).slice(2)}`,
    user: JSON.stringify({ id: userId, first_name: "Test" }),
    auth_date: String(Math.floor(now / 1000)),
    ...extra,
  });
}

type Session = { token: string; botKey: string };

async function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    session?: Session;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.session
      ? {
          authorization: `Bearer ${options.session.token}`,
          "x-bot-key": options.session.botKey,
        }
      : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as unknown) : undefined,
    text,
  };
}

async function mintSession(
  botKey: "hermes1" | "beth",
  userId: number,
): Promise<Session> {
  const token = botKey === "hermes1" ? HERMES_TOKEN : BETH_TOKEN;
  const response = await request("POST", POCKET_ROUTES.session, {
    body: { botKey, initData: initDataFor(token, userId) },
  });
  if (response.status !== 200) {
    throw new Error(`session mint failed: ${response.text}`);
  }
  const body = response.body as { sessionToken: string };
  return { token: body.sessionToken, botKey };
}

async function createRecord(
  session: Session,
  overrides: Record<string, unknown> = {},
) {
  const response = await request("POST", POCKET_ROUTES.records, {
    session,
    body: {
      source: "personal",
      title: "Draft a memo",
      category: "Writing",
      prompt: "Write a memo about X.",
      localId: `http-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    },
  });
  if (response.status !== 200) {
    throw new Error(`create failed: ${response.text}`);
  }
  return (response.body as { record: PromptRecord }).record;
}

describe("unhandled handler errors", () => {
  it("returns a safe 500 internal_error and logs it instead of leaking the error", async () => {
    // Force dispatch to reject: a store whose record lookup throws after the
    // request validated. The server's .catch must answer 500 with a body that
    // leaks nothing about the exception.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const throwingStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "getActiveRecord") {
          return () => {
            throw new Error("secret-internal-detail");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    server = createAppServer({
      v1BotToken: V1_TOKEN,
      pocket: {
        registry: loadBotRegistry(ENV),
        store: throwingStore,
        now: () => now,
        fetchImpl: telegramFetch,
        pocketRateLimiter,
      },
      log: (line) => logLines.push(line),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const session = await mintSession("hermes1", USER_A);
      const response = await request("POST", POCKET_ROUTES.promptRunV2, {
        body: {
          botKey: "hermes1",
          initData: initDataFor(HERMES_TOKEN, USER_A),
          target: { kind: "record", recordId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
        },
        session,
      });
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ status: "internal_error" });
      expect(response.text).not.toContain("secret-internal-detail");
      const line = logLines.find((entry) => entry.status === 500);
      expect(line).toBeDefined();
      expect(JSON.stringify(line)).not.toContain("secret-internal-detail");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await startServer();
    }
  });
});

describe("health and v1 rollback path", () => {
  it('GET /health returns exactly {"status":"ok"}', async () => {
    const response = await request("GET", POCKET_ROUTES.health);
    expect(response.status).toBe(200);
    expect(response.text).toBe('{"status":"ok"}');
  });

  it("v1 route still posts a catalog card with TELEGRAM_BOT_TOKEN", async () => {
    // v1 is frozen and still calls global fetch, so stub it the way the v1
    // suite does; the v2 fetchImpl injection must not reach v1.
    const v1Calls: string[] = [];
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(url).includes("api.telegram.org")) {
        v1Calls.push(String(url));
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      return originalFetch(url as never, init);
    }) as typeof fetch;

    const response = await request("POST", POCKET_ROUTES.promptRunV1, {
      body: {
        cardId: promptCatalog[0].id,
        initData: initDataFor(V1_TOKEN, USER_A),
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "posted" });
    expect(v1Calls[0]).toContain(`/bot${V1_TOKEN}/`);
    expect(telegramCalls).toHaveLength(0);
  });

  it("v1 keeps its own error shape for malformed JSON", async () => {
    const response = await request("POST", POCKET_ROUTES.promptRunV1, {
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: "rejected",
      error: "invalid_init_data",
    });
  });

  it("v1 route is not mounted when no TELEGRAM_BOT_TOKEN is configured, and never falls back to a v2 token", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({ v1BotToken: undefined });

    const response = await request("POST", POCKET_ROUTES.promptRunV1, {
      body: {
        cardId: promptCatalog[0].id,
        initData: initDataFor(HERMES_TOKEN, USER_A),
      },
    });
    expect(response.status).toBe(404);
    expect(telegramCalls).toHaveLength(0);
  });

  it("unknown routes and wrong methods are 404", async () => {
    expect((await request("GET", POCKET_ROUTES.session)).status).toBe(404);
    expect((await request("PUT", POCKET_ROUTES.pocket)).status).toBe(404);
    expect((await request("GET", "/nope")).status).toBe(404);
  });
});

describe("CORS", () => {
  it("preflight allows the session and bot headers plus every pocket method", async () => {
    const response = await fetch(`${baseUrl}${POCKET_ROUTES.pocket}`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "PATCH" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const allowHeaders =
      response.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders).toContain("content-type");
    expect(allowHeaders).toContain("authorization");
    expect(allowHeaders).toContain("x-bot-key");
    const methods = response.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      expect(methods).toContain(method);
    }
  });
});

describe("session minting", () => {
  it("mints a session without a query_id and returns only sessionToken and expiresAt", async () => {
    const initData = signInitData(HERMES_TOKEN, {
      user: JSON.stringify({
        id: USER_A,
        first_name: "Test",
        username: "tester",
      }),
      auth_date: String(Math.floor(now / 1000)),
    });
    const response = await request("POST", POCKET_ROUTES.session, {
      body: { botKey: "hermes1", initData },
    });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual([
      "expiresAt",
      "sessionToken",
    ]);
    expect(response.text).not.toContain("tester");
    expect(response.text).not.toContain(String(USER_A));
    expect(response.text).not.toContain(HERMES_TOKEN);
  });

  it("rejects unknown bot, cross-bot signature, forged, stale, and extra fields with zero writes", async () => {
    const cases: [unknown, number, string][] = [
      [
        { botKey: "nobody", initData: initDataFor(HERMES_TOKEN, USER_A) },
        400,
        "unknown_bot",
      ],
      [
        { botKey: "beth", initData: initDataFor(HERMES_TOKEN, USER_A) },
        400,
        "invalid_init_data",
      ],
      [
        {
          botKey: "hermes1",
          initData: initDataFor(HERMES_TOKEN, USER_A).replace(
            /hash=[^&]+/,
            "hash=00",
          ),
        },
        400,
        "invalid_init_data",
      ],
      [
        {
          botKey: "hermes1",
          initData: initDataFor(HERMES_TOKEN, USER_A, {
            auth_date: String(Math.floor(now / 1000) - 600),
          }),
        },
        400,
        "stale_init_data",
      ],
      [
        {
          botKey: "hermes1",
          initData: initDataFor(HERMES_TOKEN, USER_A),
          userId: 1,
        },
        400,
        "invalid_request",
      ],
      [{ botKey: "hermes1" }, 400, "invalid_request"],
    ];
    for (const [body, status, error] of cases) {
      const response = await request("POST", POCKET_ROUTES.session, { body });
      expect(response.status).toBe(status);
      expect(response.body).toEqual({ status: "rejected", error });
    }
    expect(store.getUser(USER_A)).toBeUndefined();
  });

  it("returns invalid_request for malformed JSON and oversized bodies on v2 routes", async () => {
    const malformed = await request("POST", POCKET_ROUTES.session, {
      body: "{nope",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });

    const oversized = await request("POST", POCKET_ROUTES.session, {
      body: { botKey: "hermes1", initData: "x".repeat(20 * 1024) },
    });
    expect(oversized.status).toBe(400);
    expect(oversized.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });
  });

  it("logout deletes the session", async () => {
    const session = await mintSession("hermes1", USER_A);
    const logout = await request("POST", POCKET_ROUTES.logout, { session });
    expect(logout.status).toBe(204);

    const after = await request("GET", POCKET_ROUTES.pocket, { session });
    expect(after.status).toBe(401);
    expect(after.body).toEqual({
      status: "rejected",
      error: "session_invalid",
    });
  });
});

describe("session auth on pocket routes", () => {
  it("rejects a missing, malformed, unknown, or expired bearer token", async () => {
    const session = await mintSession("hermes1", USER_A);
    const paths: [string, string][] = [
      ["GET", POCKET_ROUTES.pocket],
      ["POST", POCKET_ROUTES.records],
      ["GET", POCKET_ROUTES.export],
      ["POST", POCKET_ROUTES.import],
      ["POST", POCKET_ROUTES.logout],
      ["DELETE", POCKET_ROUTES.pocket],
      ["PATCH", POCKET_ROUTES.record("01ARZ3NDEKTSV4RRFFQ69G5FAV")],
      ["DELETE", POCKET_ROUTES.record("01ARZ3NDEKTSV4RRFFQ69G5FAV")],
      ["POST", POCKET_ROUTES.restore("01ARZ3NDEKTSV4RRFFQ69G5FAV")],
    ];

    for (const [method, path] of paths) {
      const none = await request(method, path, {
        headers: { "x-bot-key": "hermes1" },
      });
      expect(none.status).toBe(401);
      expect(none.body).toEqual({
        status: "rejected",
        error: "session_invalid",
      });

      const garbage = await request(method, path, {
        headers: { authorization: "Bearer nope", "x-bot-key": "hermes1" },
      });
      expect(garbage.status).toBe(401);

      const basic = await request(method, path, {
        headers: {
          authorization: `Basic ${session.token}`,
          "x-bot-key": "hermes1",
        },
      });
      expect(basic.status).toBe(401);
    }

    now += POCKET_LIMITS.sessionTtlMs + 1;
    const expired = await request("GET", POCKET_ROUTES.pocket, { session });
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({
      status: "rejected",
      error: "session_invalid",
    });

    // A new session mints normally afterwards.
    const fresh = await mintSession("hermes1", USER_A);
    expect(
      (await request("GET", POCKET_ROUTES.pocket, { session: fresh })).status,
    ).toBe(200);
  });

  it("a hermes1 session token with X-Bot-Key: beth is session_invalid, as is a missing header", async () => {
    const session = await mintSession("hermes1", USER_A);

    const wrongBot = await request("GET", POCKET_ROUTES.pocket, {
      session: { token: session.token, botKey: "beth" },
    });
    expect(wrongBot.status).toBe(401);
    expect(wrongBot.body).toEqual({
      status: "rejected",
      error: "session_invalid",
    });

    const missing = await request("GET", POCKET_ROUTES.pocket, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(missing.status).toBe(401);

    const malformedKey = await request("GET", POCKET_ROUTES.pocket, {
      session: { token: session.token, botKey: "HERMES1" },
    });
    expect(malformedKey.status).toBe(401);
  });
});

describe("pocket CRUD, two users, two bots", () => {
  it("User A's session cannot read, update, delete, restore, export, or dispatch User B's record", async () => {
    const a = await mintSession("hermes1", USER_A);
    const b = await mintSession("beth", USER_B);
    const bRecord = await createRecord(b, { prompt: "B's private words" });

    const list = await request("GET", POCKET_ROUTES.pocket, { session: a });
    expect((list.body as PocketListResponse).records).toEqual([]);

    const patch = await request("PATCH", POCKET_ROUTES.record(bRecord.id), {
      session: a,
      body: { revision: 1, title: "hijack" },
    });
    expect(patch.status).toBe(404);
    expect(patch.body).toEqual({ status: "rejected", error: "not_found" });

    const del = await request("DELETE", POCKET_ROUTES.record(bRecord.id), {
      session: a,
    });
    expect(del.status).toBe(404);

    const restore = await request("POST", POCKET_ROUTES.restore(bRecord.id), {
      session: a,
    });
    expect(restore.status).toBe(404);

    const exported = await request("GET", POCKET_ROUTES.export, { session: a });
    expect((exported.body as ExportResponse).records).toEqual([]);
    expect(exported.text).not.toContain("private");

    const dispatch = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "record", recordId: bRecord.id },
      },
    });
    expect(dispatch.status).toBe(400);
    expect(dispatch.body).toEqual({
      status: "rejected",
      error: "unknown_target",
    });
    expect(telegramCalls).toHaveLength(0);

    // B still sees an untouched record.
    const bList = await request("GET", POCKET_ROUTES.pocket, { session: b });
    expect((bList.body as PocketListResponse).records).toEqual([bRecord]);
  });

  it("the same user through hermes1 and beth sees the same records and edits round trip both ways", async () => {
    const viaHermes = await mintSession("hermes1", USER_A);
    const viaBeth = await mintSession("beth", USER_A);
    const record = await createRecord(viaHermes);

    const bethList = await request("GET", POCKET_ROUTES.pocket, {
      session: viaBeth,
    });
    expect((bethList.body as PocketListResponse).records).toEqual([record]);

    const bethEdit = await request("PATCH", POCKET_ROUTES.record(record.id), {
      session: viaBeth,
      body: { revision: 1, title: "Edited from Beth" },
    });
    expect(bethEdit.status).toBe(200);

    const hermesEdit = await request("PATCH", POCKET_ROUTES.record(record.id), {
      session: viaHermes,
      body: { revision: 2, prompt: "Edited from Hermes" },
    });
    expect(hermesEdit.status).toBe(200);

    const final = await request("GET", POCKET_ROUTES.pocket, {
      session: viaBeth,
    });
    expect((final.body as PocketListResponse).records[0]).toMatchObject({
      title: "Edited from Beth",
      prompt: "Edited from Hermes",
      revision: 3,
    });
  });

  it("stale revision PATCH returns 409 revision_conflict with the current record", async () => {
    const session = await mintSession("hermes1", USER_A);
    const record = await createRecord(session);
    await request("PATCH", POCKET_ROUTES.record(record.id), {
      session,
      body: { revision: 1, title: "first" },
    });

    const stale = await request("PATCH", POCKET_ROUTES.record(record.id), {
      session,
      body: { revision: 1, title: "second" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({
      status: "revision_conflict",
      current: expect.objectContaining({ revision: 2, title: "first" }),
    });
  });

  it("create replayed with the same localId returns the SAME record, never a duplicate", async () => {
    const session = await mintSession("hermes1", USER_A);
    const body = {
      source: "personal",
      title: "Meeting notes",
      category: "Pinned",
      prompt: "Turn notes into actions.",
      localId: "pin-idem-1",
    };

    const first = await request("POST", POCKET_ROUTES.records, {
      session,
      body,
    });
    expect(first.status).toBe(200);
    // Simulate a timeout-plus-retry: the identical payload (even with edited
    // content, the client's stale copy) maps to the first record.
    const retry = await request("POST", POCKET_ROUTES.records, {
      session,
      body: { ...body, title: "Stale title from the retry" },
    });
    expect(retry.status).toBe(200);

    const firstRecord = (first.body as { record: PromptRecord }).record;
    const retryRecord = (retry.body as { record: PromptRecord }).record;
    expect(retryRecord.id).toBe(firstRecord.id);
    expect(retryRecord.title).toBe("Meeting notes");
    expect(store.listRecords(USER_A)).toHaveLength(1);

    // A different user replaying the same key is a different create.
    const other = await mintSession("beth", USER_B);
    const b = await request("POST", POCKET_ROUTES.records, {
      session: other,
      body,
    });
    expect(b.status).toBe(200);
    const bRecord = (b.body as { record: PromptRecord }).record;
    expect(bRecord.id).not.toBe(firstRecord.id);
    expect(store.listRecords(USER_B)).toHaveLength(1);
  });

  it("rejects unknown fields on create and patch with invalid_request", async () => {
    const session = await mintSession("hermes1", USER_A);
    const create = await request("POST", POCKET_ROUTES.records, {
      session,
      body: {
        source: "personal",
        title: "t",
        category: "",
        prompt: "p",
        localId: "unknown-fields-1",
        ownerTelegramUserId: USER_B,
      },
    });
    expect(create.status).toBe(400);
    expect(create.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });

    const record = await createRecord(session);
    const patch = await request("PATCH", POCKET_ROUTES.record(record.id), {
      session,
      body: { revision: 1, id: "other" },
    });
    expect(patch.status).toBe(400);
    expect(patch.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });
  });

  it("oversized prompt and over-limit count are limit_exceeded with nothing written", async () => {
    const session = await mintSession("hermes1", USER_A);
    const big = await request("POST", POCKET_ROUTES.records, {
      session,
      body: {
        source: "personal",
        title: "t",
        category: "",
        prompt: "p".repeat(POCKET_LIMITS.maxPromptBytes + 1),
        localId: "oversize-1",
      },
    });
    expect(big.status).toBe(400);
    expect(big.body).toEqual({ status: "rejected", error: "limit_exceeded" });

    for (let i = 0; i < POCKET_LIMITS.maxRecordsPerUser; i += 1) {
      store.insertRecord(
        USER_A,
        {
          source: "personal",
          canonicalCardId: null,
          title: `bulk ${i}`,
          category: "",
          prompt: "p",
          hidden: false,
        },
        new Date(now).toISOString(),
      );
    }
    const over = await request("POST", POCKET_ROUTES.records, {
      session,
      body: {
        source: "personal",
        title: "one more",
        category: "",
        prompt: "p",
        localId: "over-limit-1",
      },
    });
    expect(over.status).toBe(400);
    expect(over.body).toEqual({ status: "rejected", error: "limit_exceeded" });
    expect(store.countActiveRecords(USER_A)).toBe(
      POCKET_LIMITS.maxRecordsPerUser,
    );
  });

  it("soft-deleted record: absent from GET, in export with deletedAt, restorable, unknown_target for dispatch", async () => {
    const session = await mintSession("hermes1", USER_A);
    const record = await createRecord(session);

    const del = await request("DELETE", POCKET_ROUTES.record(record.id), {
      session,
    });
    expect(del.status).toBe(204);
    expect(del.text).toBe("");

    const list = await request("GET", POCKET_ROUTES.pocket, { session });
    expect((list.body as PocketListResponse).records).toEqual([]);

    const exported = await request("GET", POCKET_ROUTES.export, { session });
    expect((exported.body as ExportResponse).records).toEqual([
      expect.objectContaining({
        id: record.id,
        deletedAt: new Date(now).toISOString(),
      }),
    ]);

    const dispatch = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "record", recordId: record.id },
      },
    });
    expect(dispatch.body).toEqual({
      status: "rejected",
      error: "unknown_target",
    });
    expect(telegramCalls).toHaveLength(0);

    const restore = await request("POST", POCKET_ROUTES.restore(record.id), {
      session,
    });
    expect(restore.status).toBe(200);
    expect((restore.body as { record: PromptRecord }).record.id).toBe(
      record.id,
    );

    const after = await request("GET", POCKET_ROUTES.pocket, { session });
    expect((after.body as PocketListResponse).records).toHaveLength(1);
  });

  it("import replayed twice imports nothing the second time", async () => {
    const session = await mintSession("hermes1", USER_A);
    const payload = {
      records: [
        {
          localId: "pinned-1",
          source: "personal",
          title: "Pinned",
          category: "",
          prompt: "Pinned prompt text.",
        },
        {
          localId: "edit-clear-email",
          source: "canonical-override",
          canonicalCardId: "clear-email",
          title: "My email",
          category: "Writing",
          prompt: "My email words.",
        },
      ],
    };

    const first = await request("POST", POCKET_ROUTES.import, {
      session,
      body: payload,
    });
    expect(first.status).toBe(200);
    const firstBody = first.body as ImportResponse;
    expect(firstBody.imported).toEqual(["pinned-1", "edit-clear-email"]);
    expect(firstBody.skipped).toEqual([]);

    const second = await request("POST", POCKET_ROUTES.import, {
      session,
      body: payload,
    });
    const secondBody = second.body as ImportResponse;
    expect(secondBody.imported).toEqual([]);
    expect(secondBody.skipped).toEqual(["pinned-1", "edit-clear-email"]);
    expect(secondBody.mapping).toEqual(firstBody.mapping);

    const list = await request("GET", POCKET_ROUTES.pocket, { session });
    expect((list.body as PocketListResponse).records).toHaveLength(2);
  });

  it("DELETE /api/v2/pocket needs the exact confirm phrase, then removes rows and sessions", async () => {
    const session = await mintSession("hermes1", USER_A);
    const other = await mintSession("beth", USER_B);
    await createRecord(session);
    const otherRecord = await createRecord(other);

    const wrong = await request("DELETE", POCKET_ROUTES.pocket, {
      session,
      body: { confirm: "yes" },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });

    const ok = await request("DELETE", POCKET_ROUTES.pocket, {
      session,
      body: { confirm: "delete everything" },
    });
    expect(ok.status).toBe(204);

    const after = await request("GET", POCKET_ROUTES.pocket, { session });
    expect(after.status).toBe(401);
    expect(store.exportRecords(USER_A)).toEqual([]);
    expect(store.getActiveRecord(USER_B, otherRecord.id)).toBeDefined();
  });

  it("returns not_found for a record id that is not a valid id shape", async () => {
    const session = await mintSession("hermes1", USER_A);
    const response = await request("PATCH", POCKET_ROUTES.record("../etc"), {
      session,
      body: { revision: 1, title: "x" },
    });
    expect([400, 404]).toContain(response.status);
  });

  it("rate limits pocket requests per user across bots", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    pocketRateLimiter = new SlidingWindowRateLimiter({
      // Two session mints plus three reads share the same per-user budget.
      limit: 5,
      windowMs: 10 * 60 * 1000,
      clock: () => now,
    });
    await startServer();
    const viaHermes = await mintSession("hermes1", USER_A);
    const viaBeth = await mintSession("beth", USER_A);

    expect(
      (await request("GET", POCKET_ROUTES.pocket, { session: viaHermes }))
        .status,
    ).toBe(200);
    expect(
      (await request("GET", POCKET_ROUTES.pocket, { session: viaBeth })).status,
    ).toBe(200);
    expect(
      (await request("GET", POCKET_ROUTES.pocket, { session: viaHermes }))
        .status,
    ).toBe(200);
    const limited = await request("GET", POCKET_ROUTES.pocket, {
      session: viaBeth,
    });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ status: "rejected", error: "rate_limited" });

    const other = await mintSession("hermes1", USER_B);
    expect(
      (await request("GET", POCKET_ROUTES.pocket, { session: other })).status,
    ).toBe(200);
  });
});

describe("prompt-run v2 over HTTP", () => {
  it("posts with the matching bot, rejects the other bot's signature, and honors the kill switch", async () => {
    const posted = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "beth",
        initData: initDataFor(BETH_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({ status: "posted" });
    expect(telegramCalls[0].url).toContain(`/bot${BETH_TOKEN}/`);

    const crossed = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(BETH_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });
    expect(crossed.status).toBe(400);
    expect(crossed.body).toEqual({
      status: "rejected",
      error: "invalid_init_data",
    });

    const extra = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
        token: "leak",
      },
    });
    expect(extra.body).toEqual({
      status: "rejected",
      error: "invalid_request",
    });

    const v1Token = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(V1_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });
    expect(v1Token.body).toEqual({
      status: "rejected",
      error: "invalid_init_data",
    });
    expect(telegramCalls).toHaveLength(1);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({}, { PROMPT_POCKET_DISPATCH_DISABLED: "1" });
    const disabled = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });
    expect(disabled.status).toBe(503);
    expect(disabled.body).toEqual({ status: "dispatch_disabled" });
    expect(telegramCalls).toHaveLength(1);
  });

  it("v2 routes are not mounted when pocket is not configured", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer({ pocket: undefined });
    const response = await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "hermes1",
        initData: initDataFor(HERMES_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });
    expect(response.status).toBe(404);
    expect((await request("GET", POCKET_ROUTES.health)).status).toBe(200);
  });
});

describe("structured request log", () => {
  it("emits one sanitized outcome line per request", async () => {
    const session = await mintSession("hermes1", USER_A);
    logLines = [];
    await createRecord(session, { prompt: "never-logged-prompt-text" });
    await request("GET", POCKET_ROUTES.health);
    await request("POST", POCKET_ROUTES.promptRunV2, {
      body: {
        botKey: "beth",
        initData: initDataFor(BETH_TOKEN, USER_A),
        target: { kind: "catalog", cardId: promptCatalog[0].id },
      },
    });

    expect(logLines).toHaveLength(3);
    for (const line of logLines) {
      expect(Object.keys(line).sort()).toEqual([
        "botKey",
        "error",
        "latencyMs",
        "requestId",
        "route",
        "status",
      ]);
      expect(typeof line.requestId).toBe("string");
      expect(typeof line.latencyMs).toBe("number");
    }
    expect(logLines[0]).toMatchObject({
      botKey: "hermes1",
      route: POCKET_ROUTES.records,
      status: 200,
    });
    expect(logLines[1]).toMatchObject({
      botKey: null,
      route: POCKET_ROUTES.health,
      status: 200,
    });
    expect(logLines[2]).toMatchObject({
      botKey: "beth",
      route: POCKET_ROUTES.promptRunV2,
      status: 200,
    });
    const serialized = JSON.stringify(logLines);
    expect(serialized).not.toContain("never-logged-prompt-text");
    expect(serialized).not.toContain(session.token);
    expect(serialized).not.toContain(String(USER_A));
  });

  it("does not log a junk bot key from the request", async () => {
    logLines = [];
    await request("POST", POCKET_ROUTES.session, {
      body: { botKey: "<script>", initData: "x" },
    });
    expect(logLines[0].botKey).toBeNull();
  });
});
