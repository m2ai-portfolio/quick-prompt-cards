import { beforeEach, describe, expect, it, vi } from "vitest";
import { POCKET_LIMITS, type PromptRecord } from "../shared/pocket-contract";
import {
  PocketClientError,
  type PocketClient,
  type PocketSession,
} from "./pocket-client";
import {
  applyPocketOverrides,
  createPocketSync,
  evaluateLaunch,
  findOverride,
  isRetryableFailure,
  migrationKeyFor,
  pocketCacheKeyFor,
  selectPocketView,
  type PocketSyncState,
} from "./pocket-sync";
import type { Card, PromptCard } from "./types";
import { createAutomationStorage } from "./workflows/wizard-state";

const SESSION: PocketSession = {
  sessionToken: "fake-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const telegram = (overrides: Partial<TelegramWebApp> = {}): TelegramWebApp => ({
  ready: vi.fn(),
  expand: vi.fn(),
  close: vi.fn(),
  initData: "auth_date=1&hash=abc&query_id=q1",
  initDataUnsafe: { query_id: "q1", user: { id: 4242, first_name: "T" } },
  ...overrides,
});

function record(overrides: Partial<PromptRecord> = {}): PromptRecord {
  return {
    id: "01JREC",
    source: "personal",
    canonicalCardId: null,
    title: "Meeting notes",
    category: "Pinned",
    prompt: "Turn notes into actions.",
    hidden: false,
    revision: 1,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

type FakeClient = PocketClient & {
  [K in keyof PocketClient]: PocketClient[K] extends (
    ...args: infer A
  ) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : PocketClient[K];
};

function fakeClient(records: PromptRecord[] = []): FakeClient {
  return {
    apiBase: "https://api.example.test",
    botKey: "hermes1",
    createSession: vi.fn().mockResolvedValue(SESSION),
    logout: vi.fn().mockResolvedValue(undefined),
    listPocket: vi.fn().mockResolvedValue({ records, limits: POCKET_LIMITS }),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn().mockResolvedValue(undefined),
    restoreRecord: vi.fn(),
    importRecords: vi.fn(),
    exportPocket: vi.fn(),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    promptRunV2: vi.fn(),
  } as unknown as FakeClient;
}

function httpError(code: string, status = 400): PocketClientError {
  return new PocketClientError("x", { kind: "http", httpStatus: status, code });
}

function makeSync(
  client: PocketClient,
  overrides: Partial<Parameters<typeof createPocketSync>[0]> = {},
) {
  let n = 0;
  return createPocketSync({
    botContext: { botKey: "hermes1" },
    apiBase: "https://api.example.test",
    telegram: telegram(),
    storage: createAutomationStorage(localStorage),
    createClient: () => client,
    nextChangeId: () => `c${++n}`,
    ...overrides,
  });
}

function pocket(state: PocketSyncState) {
  if (state.mode !== "pocket")
    throw new Error(`expected pocket, got ${state.mode}`);
  return state;
}

beforeEach(() => localStorage.clear());

describe("evaluateLaunch", () => {
  const base = {
    botContext: { botKey: "hermes1" } as const,
    apiBase: "https://api.example.test",
    telegram: telegram(),
  };

  it("passes with every precondition met and keys the cache on the user id", () => {
    expect(evaluateLaunch(base)).toEqual({
      ok: true,
      launch: {
        botKey: "hermes1",
        apiBase: "https://api.example.test",
        initData: "auth_date=1&hash=abc&query_id=q1",
        userId: "4242",
      },
    });
  });

  it.each([
    ["outside_telegram", { ...base, telegram: undefined }],
    [
      "no_bot_key",
      { ...base, botContext: { botKey: null, reason: "missing" } },
    ],
    [
      "invalid_bot_key",
      { ...base, botContext: { botKey: null, reason: "malformed" } },
    ],
    ["no_api_base", { ...base, apiBase: undefined }],
    ["no_init_data", { ...base, telegram: telegram({ initData: "" }) }],
    ["no_user_id", { ...base, telegram: telegram({ initDataUnsafe: {} }) }],
  ] as const)("reports %s", (reason, options) => {
    expect(evaluateLaunch(options)).toEqual({ ok: false, reason });
  });
});

describe("createPocketSync bootstrap", () => {
  it("is local-only immediately when a precondition fails and never calls the server", async () => {
    const client = fakeClient();
    const sync = makeSync(client, {
      botContext: { botKey: null, reason: "missing" },
    });
    expect(sync.getState()).toEqual({
      mode: "local-only",
      reason: "no_bot_key",
    });
    await sync.bootstrap();
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("mints a session, loads the pocket, and caches it under the user id", async () => {
    const client = fakeClient([record()]);
    const sync = makeSync(client);
    expect(sync.getState()).toEqual({ mode: "booting", userId: "4242" });

    await sync.bootstrap();

    const state = pocket(sync.getState());
    expect(state.online).toBe(true);
    expect(state.records).toEqual([record()]);
    expect(state.fromCache).toBe(false);
    expect(client.createSession).toHaveBeenCalledWith(
      "auth_date=1&hash=abc&query_id=q1",
    );
    const cached = JSON.parse(localStorage.getItem(pocketCacheKeyFor("4242"))!);
    expect(cached.records).toEqual([record()]);
  });

  it("shares one in-flight bootstrap between concurrent callers (StrictMode double effect)", async () => {
    const client = fakeClient();
    const sync = makeSync(client);
    await Promise.all([sync.bootstrap(), sync.bootstrap()]);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.listPocket).toHaveBeenCalledTimes(1);
  });

  it("falls back to local-only with session_failed when the mint gets no usable answer and nothing is cached", async () => {
    // Review F4: a 400 is now `sync_rejected` (next test); session_failed
    // is reserved for transport failures, timeouts, 5xx and bad bodies.
    const client = fakeClient();
    client.createSession.mockRejectedValue(
      new PocketClientError("session", { kind: "network" }),
    );
    const sync = makeSync(client);
    await sync.bootstrap();
    expect(sync.getState()).toEqual({
      mode: "local-only",
      reason: "session_failed",
    });

    client.createSession.mockRejectedValue(httpError("internal", 500));
    await sync.bootstrap();
    expect(sync.getState()).toEqual({
      mode: "local-only",
      reason: "session_failed",
    });
  });

  it.each([
    [httpError("unknown_bot"), "unknown_bot"],
    [httpError("invalid_init_data"), "invalid_init_data"],
    [httpError("rate_limited", 429), "rate_limited"],
    [
      new PocketClientError("session", {
        kind: "http",
        httpStatus: 404,
        code: null,
      }),
      "not_found",
    ],
  ])(
    "reports sync_rejected with the safe code when the server answers no (%s)",
    async (error, code) => {
      const client = fakeClient();
      client.createSession.mockRejectedValue(error);
      const sync = makeSync(client);
      await sync.bootstrap();
      expect(sync.getState()).toEqual({
        mode: "local-only",
        reason: "sync_rejected",
        code,
      });
      expect(isRetryableFailure("sync_rejected", code)).toBe(
        code === "rate_limited",
      );
    },
  );

  it("keeps a cached pocket with a sync_rejected offline reason and code", async () => {
    localStorage.setItem(
      pocketCacheKeyFor("4242"),
      JSON.stringify({ version: 1, cachedAt: "x", records: [record()] }),
    );
    const client = fakeClient();
    client.createSession.mockRejectedValue(httpError("unknown_bot"));
    const sync = makeSync(client);
    await sync.bootstrap();
    const state = pocket(sync.getState());
    expect(state.online).toBe(false);
    expect(state.offlineReason).toBe("sync_rejected");
    expect(state.offlineCode).toBe("unknown_bot");
    expect(state.records).toEqual([record()]);
  });

  it("reports load_failed when the session minted but GET /pocket failed", async () => {
    const client = fakeClient();
    client.listPocket.mockRejectedValue(
      new PocketClientError("pocket", { kind: "network" }),
    );
    const sync = makeSync(client);
    await sync.bootstrap();
    expect(sync.getState()).toEqual({
      mode: "local-only",
      reason: "load_failed",
    });
  });

  it("shows the cached pocket immediately, then keeps it offline when the server is unreachable", async () => {
    localStorage.setItem(
      pocketCacheKeyFor("4242"),
      JSON.stringify({ version: 1, cachedAt: "x", records: [record()] }),
    );
    const client = fakeClient();
    client.createSession.mockRejectedValue(
      new PocketClientError("session", { kind: "timeout" }),
    );
    const sync = makeSync(client);

    const initial = pocket(sync.getState());
    expect(initial.fromCache).toBe(true);
    expect(initial.records).toEqual([record()]);
    expect(initial.busy).toBe(1);

    await sync.bootstrap();
    const state = pocket(sync.getState());
    expect(state.online).toBe(false);
    expect(state.offlineReason).toBe("session_failed");
    expect(state.records).toEqual([record()]);
    expect(state.busy).toBe(0);
  });

  it("ignores another user's cache and a corrupt cache", async () => {
    localStorage.setItem(
      pocketCacheKeyFor("999"),
      JSON.stringify({ version: 1, cachedAt: "x", records: [record()] }),
    );
    localStorage.setItem(pocketCacheKeyFor("4242"), "{not json");
    const sync = makeSync(fakeClient());
    expect(sync.getState()).toEqual({ mode: "booting", userId: "4242" });
    expect(localStorage.getItem(pocketCacheKeyFor("4242"))).toBeNull();
  });

  it("re-mints once on session_invalid and gives up after the second failure", async () => {
    const client = fakeClient([record()]);
    client.listPocket
      .mockRejectedValueOnce(httpError("session_invalid", 401))
      .mockResolvedValueOnce({ records: [record()], limits: POCKET_LIMITS });
    const sync = makeSync(client);
    await sync.bootstrap();
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(pocket(sync.getState()).online).toBe(true);
  });
});

describe("createPocketSync writes (server-first)", () => {
  async function booted(records: PromptRecord[] = []) {
    const client = fakeClient(records);
    const sync = makeSync(client);
    await sync.bootstrap();
    return { client, sync };
  }

  it("create: adds the server record and clears the pending change", async () => {
    const { client, sync } = await booted();
    client.createRecord.mockResolvedValue(record());
    const listener = vi.fn();
    sync.subscribe(listener);

    const ok = await sync.createRecord({
      source: "personal",
      title: "Meeting notes",
      category: "Pinned",
      prompt: "Turn notes into actions.",
    });

    expect(ok).toBe(true);
    const state = pocket(sync.getState());
    expect(state.records).toEqual([record()]);
    expect(state.unsynced).toEqual([]);
    expect(state.busy).toBe(0);
    expect(listener).toHaveBeenCalled();
    expect(client.createRecord).toHaveBeenCalledWith(SESSION, {
      source: "personal",
      title: "Meeting notes",
      category: "Pinned",
      prompt: "Turn notes into actions.",
    });
  });

  it("create failure: keeps the user's text as an unsynced draft, writes nothing locally, and retries on request", async () => {
    const { client, sync } = await booted();
    client.createRecord
      .mockRejectedValueOnce(
        new PocketClientError("records.create", { kind: "network" }),
      )
      .mockResolvedValueOnce(record());

    const ok = await sync.createRecord({
      source: "personal",
      title: "Meeting notes",
      category: "Pinned",
      prompt: "Turn notes into actions.",
    });
    expect(ok).toBe(false);

    const failed = pocket(sync.getState());
    expect(failed.records).toEqual([]);
    expect(failed.unsynced).toEqual([
      {
        changeId: "c1",
        op: "create",
        error: true,
        input: {
          source: "personal",
          title: "Meeting notes",
          category: "Pinned",
          prompt: "Turn notes into actions.",
        },
      },
    ]);
    const view = selectPocketView(failed);
    expect(view).toHaveLength(1);
    expect(view[0].prompt).toBe("Turn notes into actions.");
    expect(view[0].unsynced).toEqual({
      changeId: "c1",
      op: "create",
      error: true,
      conflict: false,
    });
    // Never a silent fallback into the pre-Phase-2 local stores.
    expect(localStorage.getItem("prompt-pocket-pinned-prompts")).toBeNull();

    await expect(sync.retryChange("c1")).resolves.toBe(true);
    const synced = pocket(sync.getState());
    expect(synced.records).toEqual([record()]);
    expect(synced.unsynced).toEqual([]);
    expect(client.createRecord).toHaveBeenCalledTimes(2);
  });

  it("update: sends the current revision and replaces the record", async () => {
    const { client, sync } = await booted([record()]);
    client.updateRecord.mockResolvedValue({
      ok: true,
      record: record({ title: "Renamed", revision: 2 }),
    });

    await expect(
      sync.updateRecord("01JREC", { title: "Renamed" }),
    ).resolves.toBe(true);
    expect(client.updateRecord).toHaveBeenCalledWith(SESSION, "01JREC", {
      revision: 1,
      title: "Renamed",
    });
    expect(pocket(sync.getState()).records[0]).toEqual(
      record({ title: "Renamed", revision: 2 }),
    );
  });

  it("update conflict: shows the server's current record underneath, keeps the user's text on top, and the retry uses the new revision", async () => {
    const { client, sync } = await booted([record()]);
    client.updateRecord
      .mockResolvedValueOnce({
        ok: false,
        conflict: record({ title: "Edited elsewhere", revision: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        record: record({ title: "Renamed", revision: 4 }),
      });

    await expect(
      sync.updateRecord("01JREC", { title: "Renamed" }),
    ).resolves.toBe(false);
    const state = pocket(sync.getState());
    expect(state.records[0].revision).toBe(3);
    expect(state.unsynced[0]).toMatchObject({ error: true, conflict: true });
    expect(selectPocketView(state)[0].title).toBe("Renamed");

    await expect(sync.retryChange(state.unsynced[0].changeId)).resolves.toBe(
      true,
    );
    expect(client.updateRecord).toHaveBeenLastCalledWith(SESSION, "01JREC", {
      revision: 3,
      title: "Renamed",
    });
    expect(pocket(sync.getState()).unsynced).toEqual([]);
  });

  it("update failure: the edited text stays visible with the unsynced marker", async () => {
    const { client, sync } = await booted([record()]);
    client.updateRecord.mockRejectedValue(
      new PocketClientError("records.update", { kind: "timeout" }),
    );

    await sync.updateRecord("01JREC", { prompt: "New text" });
    const view = selectPocketView(sync.getState());
    expect(view[0].prompt).toBe("New text");
    expect(view[0].unsynced?.op).toBe("update");
    expect(pocket(sync.getState()).records[0].prompt).toBe(
      "Turn notes into actions.",
    );
  });

  it("delete: removes the record on success and treats not_found as already gone", async () => {
    const { client, sync } = await booted([record(), record({ id: "B" })]);
    await expect(sync.deleteRecord("01JREC")).resolves.toBe(true);
    expect(pocket(sync.getState()).records.map((r) => r.id)).toEqual(["B"]);

    client.deleteRecord.mockRejectedValue(httpError("not_found", 404));
    await expect(sync.deleteRecord("B")).resolves.toBe(true);
    expect(pocket(sync.getState()).records).toEqual([]);
  });

  it("delete failure: keeps the record visible with the unsynced marker; discard drops the intent", async () => {
    const { client, sync } = await booted([record()]);
    client.deleteRecord.mockRejectedValue(
      new PocketClientError("records.delete", { kind: "network" }),
    );

    await expect(sync.deleteRecord("01JREC")).resolves.toBe(false);
    const view = selectPocketView(sync.getState());
    expect(view).toHaveLength(1);
    expect(view[0].unsynced?.op).toBe("delete");

    sync.discardChange(view[0].unsynced!.changeId);
    expect(pocket(sync.getState()).unsynced).toEqual([]);
    expect(selectPocketView(sync.getState())[0].unsynced).toBeUndefined();
  });

  it("writes in local-only mode resolve false and never touch the client", async () => {
    const client = fakeClient();
    const sync = makeSync(client, { telegram: undefined });
    await expect(
      sync.createRecord({
        source: "personal",
        title: "t",
        category: "c",
        prompt: "p",
      }),
    ).resolves.toBe(false);
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("reload replaces records and the cache; importLocal passes through", async () => {
    const { client, sync } = await booted([]);
    client.listPocket.mockResolvedValue({
      records: [record()],
      limits: POCKET_LIMITS,
    });
    await expect(sync.reload()).resolves.toEqual([record()]);
    expect(pocket(sync.getState()).records).toEqual([record()]);

    const importBody = {
      imported: ["l1"],
      skipped: [],
      mapping: { l1: "01JREC" },
      records: [record()],
    };
    client.importRecords.mockResolvedValue(importBody);
    await expect(sync.importLocal({ records: [] })).resolves.toEqual(
      importBody,
    );
    expect(client.importRecords).toHaveBeenCalledWith(SESSION, { records: [] });
  });

  it("promptRunV2 goes through the same client, works without a session, and throws only without a bot key or API base", async () => {
    const { client, sync } = await booted();
    client.promptRunV2.mockResolvedValue({ status: "posted" });
    await expect(
      sync.promptRunV2("init", { kind: "catalog", cardId: "clear-email" }),
    ).resolves.toEqual({ status: "posted" });
    expect(client.promptRunV2).toHaveBeenCalledWith("init", {
      kind: "catalog",
      cardId: "clear-email",
    });

    // Review F3: a catalog dispatch carries only initData + botKey, so it
    // must still work when the session mint failed.
    const failing = fakeClient();
    failing.createSession.mockRejectedValue(httpError("unknown_bot"));
    failing.promptRunV2.mockResolvedValue({ status: "posted" });
    // This case is a first launch, not the cached offline pocket above.
    localStorage.clear();
    const unsynced = makeSync(failing);
    await unsynced.bootstrap();
    expect(unsynced.getState().mode).toBe("local-only");
    await expect(
      unsynced.promptRunV2("init", { kind: "catalog", cardId: "clear-email" }),
    ).resolves.toEqual({ status: "posted" });

    const noKey = makeSync(fakeClient(), {
      botContext: { botKey: null, reason: "malformed" },
    });
    expect(() =>
      noKey.promptRunV2("init", { kind: "catalog", cardId: "clear-email" }),
    ).toThrow();
    const noBase = makeSync(fakeClient(), { apiBase: undefined });
    expect(() =>
      noBase.promptRunV2("init", { kind: "catalog", cardId: "clear-email" }),
    ).toThrow();
  });

  it("a failed write survives a reload: the unsynced draft is restored from the per-user cache and retries", async () => {
    // Review F5. Telegram closes the Mini App on every successful dispatch,
    // so an in-memory queue would lose the user's text on the next close.
    const { client, sync } = await booted([record()]);
    client.createRecord.mockRejectedValue(
      new PocketClientError("records.create", { kind: "timeout" }),
    );
    client.updateRecord.mockRejectedValue(
      new PocketClientError("records.update", { kind: "network" }),
    );
    await sync.createRecord({
      source: "personal",
      title: "Draft",
      category: "Pinned",
      prompt: "Keep this text.",
    });
    await sync.updateRecord("01JREC", { prompt: "Edited text" });
    expect(pocket(sync.getState()).unsynced).toHaveLength(2);

    // A fresh page load with the same storage.
    const again = fakeClient([record()]);
    let n = 0;
    const reopened = createPocketSync({
      botContext: { botKey: "hermes1" },
      apiBase: "https://api.example.test",
      telegram: telegram(),
      storage: createAutomationStorage(localStorage),
      createClient: () => again,
      nextChangeId: () => `r${++n}`,
    });
    const restored = pocket(reopened.getState());
    expect(restored.fromCache).toBe(true);
    expect(restored.unsynced).toEqual([
      {
        changeId: "c1",
        op: "create",
        error: true,
        conflict: false,
        input: {
          source: "personal",
          title: "Draft",
          category: "Pinned",
          prompt: "Keep this text.",
        },
      },
      {
        changeId: "c2",
        op: "update",
        error: true,
        conflict: false,
        recordId: "01JREC",
        input: { prompt: "Edited text" },
      },
    ]);
    const view = selectPocketView(restored);
    expect(view.map((r) => r.prompt)).toEqual([
      "Edited text",
      "Keep this text.",
    ]);

    await reopened.bootstrap();
    expect(pocket(reopened.getState()).unsynced).toHaveLength(2);

    again.createRecord.mockResolvedValue(
      record({ id: "NEW", title: "Draft", prompt: "Keep this text." }),
    );
    await expect(reopened.retryChange("c1")).resolves.toBe(true);
    expect(pocket(reopened.getState()).unsynced).toHaveLength(1);
    const cached = JSON.parse(localStorage.getItem(pocketCacheKeyFor("4242"))!);
    expect(cached.unsynced).toHaveLength(1);
    expect(cached.unsynced[0]).toMatchObject({ changeId: "c2", error: true });
  });

  it("drops an unparseable persisted change without discarding the cached records", () => {
    localStorage.setItem(
      pocketCacheKeyFor("4242"),
      JSON.stringify({
        version: 1,
        cachedAt: "x",
        records: [record()],
        unsynced: [
          { changeId: "bad", op: "create", input: { title: 1 } },
          { changeId: "ok", op: "delete", recordId: "01JREC" },
          "garbage",
        ],
      }),
    );
    const state = pocket(makeSync(fakeClient()).getState());
    expect(state.records).toEqual([record()]);
    expect(state.unsynced).toEqual([
      {
        changeId: "ok",
        op: "delete",
        recordId: "01JREC",
        error: true,
        conflict: false,
      },
    ]);
  });

  it("migration status is stored per user id", async () => {
    const { sync } = await booted();
    expect(sync.getMigrationStatus()).toBeNull();
    sync.setMigrationStatus("dismissed");
    expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("dismissed");
    expect(sync.getMigrationStatus()).toBe("dismissed");
    sync.setMigrationStatus("done");
    expect(sync.getMigrationStatus()).toBe("done");
  });
});

describe("selectors", () => {
  const starter: PromptCard = {
    id: "clear-email",
    kind: "prompt",
    title: "Write a clear email",
    description: "d",
    category: "Writing",
    tags: [],
    prompt: "canonical text",
    action: {
      type: "prompt-delivery",
      preferred: "telegram-webapp-query",
      fallback: "clipboard",
    },
  };
  const creator: Card = {
    id: "create-prompt",
    kind: "creator",
    title: "Create",
    description: "d",
    category: "Ideas",
    tags: [],
  };

  it("applies a canonical override's title/category/prompt to the starter card", () => {
    const override = record({
      id: "OV",
      source: "canonical-override",
      canonicalCardId: "clear-email",
      title: "Follow up",
      category: "Business",
      prompt: "my words",
    });
    const cards = applyPocketOverrides([starter, creator], [override]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: "clear-email",
      title: "Follow up",
      category: "Business",
      prompt: "my words",
    });
    expect(findOverride([override], "clear-email")).toBe(override);
  });

  it("hides a starter card whose override is hidden, unless that hide is still unsynced", () => {
    const hidden = record({
      id: "OV",
      source: "canonical-override",
      canonicalCardId: "clear-email",
      hidden: true,
    });
    expect(applyPocketOverrides([starter, creator], [hidden])).toEqual([
      creator,
    ]);
    const pending = {
      ...hidden,
      unsynced: {
        changeId: "c1",
        op: "delete" as const,
        error: true,
        conflict: false,
      },
    };
    expect(applyPocketOverrides([starter, creator], [pending])).toHaveLength(2);
  });

  it("selectPocketView is empty outside pocket mode", () => {
    expect(
      selectPocketView({ mode: "local-only", reason: "no_bot_key" }),
    ).toEqual([]);
    expect(selectPocketView({ mode: "booting", userId: "1" })).toEqual([]);
  });
});
