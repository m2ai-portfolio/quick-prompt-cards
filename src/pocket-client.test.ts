import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POCKET_ROUTES, type PromptRecord } from "../shared/pocket-contract";
import {
  PocketClientError,
  createPocketClient,
  getPocketApiBase,
} from "./pocket-client";

const API_BASE = "https://api.example.test/prompt-pocket";
const SESSION = { sessionToken: "fake-session-token", expiresAt: "2099-01-01" };
const SECRET_PROMPT = "SECRET-PROMPT-TEXT-never-in-errors";

const record: PromptRecord = {
  id: "01JREC0000000000000000000A",
  source: "personal",
  canonicalCardId: null,
  title: "Meeting notes",
  category: "Pinned",
  prompt: SECRET_PROMPT,
  hidden: false,
  revision: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init: RequestInit };

function lastCall(fetchMock: ReturnType<typeof vi.fn>): Call {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

describe("getPocketApiBase", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is undefined when unset or blank", () => {
    vi.stubEnv("VITE_PROMPT_POCKET_API_BASE", "");
    expect(getPocketApiBase()).toBeUndefined();
    vi.stubEnv("VITE_PROMPT_POCKET_API_BASE", "   ");
    expect(getPocketApiBase()).toBeUndefined();
  });

  it("strips trailing slashes so route concatenation never doubles them", () => {
    vi.stubEnv("VITE_PROMPT_POCKET_API_BASE", `${API_BASE}//`);
    expect(getPocketApiBase()).toBe(API_BASE);
  });
});

describe("createPocketClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const client = () =>
    createPocketClient({ apiBase: API_BASE, botKey: "hermes1" });

  it("refuses a bot key outside the grammar at construction", () => {
    expect(() =>
      createPocketClient({ apiBase: API_BASE, botKey: "../evil" }),
    ).toThrow();
    expect(() =>
      createPocketClient({ apiBase: API_BASE, botKey: "HERMES1" }),
    ).toThrow();
  });

  it("builds every URL from apiBase + POCKET_ROUTES; the bot key never touches the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { records: [], limits: {} }));
    const c = createPocketClient({ apiBase: `${API_BASE}/`, botKey: "beth" });

    await c.listPocket(SESSION);
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.pocket}`);
    expect(call.url).not.toContain("beth");
    expect(headersOf(call)["x-bot-key"]).toBe("beth");
  });

  it("session: POSTs { botKey, initData } with the bot key header and no bearer", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { sessionToken: "tok", expiresAt: "2099-01-01" }),
    );

    const session = await client().createSession("auth_date=1&hash=x");
    expect(session).toEqual({ sessionToken: "tok", expiresAt: "2099-01-01" });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.session}`);
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body as string)).toEqual({
      botKey: "hermes1",
      initData: "auth_date=1&hash=x",
    });
    expect(headersOf(call).authorization).toBeUndefined();
    expect(headersOf(call)["x-bot-key"]).toBe("hermes1");
  });

  it("session: a body without a token is malformed, not a session", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { expiresAt: "2099" }));
    await expect(client().createSession("x")).rejects.toMatchObject({
      failure: { kind: "malformed", httpStatus: 200 },
    });
  });

  it("pocket routes send Bearer + X-Bot-Key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { records: [record], limits: {} }),
    );

    const list = await client().listPocket(SESSION);
    expect(list.records).toEqual([record]);

    const headers = headersOf(lastCall(fetchMock));
    expect(headers.authorization).toBe("Bearer fake-session-token");
    expect(headers["x-bot-key"]).toBe("hermes1");
  });

  it("list: rejects a malformed record list", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { records: [{ id: 1 }], limits: {} }),
    );
    await expect(client().listPocket(SESSION)).rejects.toBeInstanceOf(
      PocketClientError,
    );
  });

  it("create: POSTs the record body and returns the record", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { record }));
    const created = await client().createRecord(SESSION, {
      source: "personal",
      title: "Meeting notes",
      category: "Pinned",
      prompt: SECRET_PROMPT,
      localId: "test-local-1",
    });
    expect(created).toEqual(record);
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.records}`);
    expect(call.init.method).toBe("POST");
  });

  it("update: PATCHes the encoded record route with the revision", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { record: { ...record, revision: 2 } }),
    );
    const result = await client().updateRecord(SESSION, "a/b c", {
      revision: 1,
      title: "Renamed",
    });
    expect(result).toEqual({ ok: true, record: { ...record, revision: 2 } });
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.record("a/b c")}`);
    expect(call.url).toContain("a%2Fb%20c");
    expect(call.init.method).toBe("PATCH");
    expect(JSON.parse(call.init.body as string)).toEqual({
      revision: 1,
      title: "Renamed",
    });
  });

  it("update: a 409 revision_conflict returns the current record instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        status: "revision_conflict",
        current: { ...record, revision: 5 },
      }),
    );
    const result = await client().updateRecord(SESSION, record.id, {
      revision: 1,
      title: "Renamed",
    });
    expect(result).toEqual({ ok: false, conflict: { ...record, revision: 5 } });
  });

  it("delete: DELETE on the record route resolves on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      client().deleteRecord(SESSION, record.id),
    ).resolves.toBeUndefined();
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.record(record.id)}`);
    expect(call.init.method).toBe("DELETE");
    expect(call.init.body).toBeUndefined();
  });

  it("restore: POSTs the restore route and returns the record", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { record }));
    await expect(client().restoreRecord(SESSION, record.id)).resolves.toEqual(
      record,
    );
    expect(lastCall(fetchMock).url).toBe(
      `${API_BASE}${POCKET_ROUTES.restore(record.id)}`,
    );
  });

  it("import: returns imported/skipped/mapping/records", async () => {
    const body = {
      imported: ["l1"],
      skipped: ["l2"],
      mapping: { l1: record.id, l2: "other" },
      records: [record],
    };
    fetchMock.mockResolvedValue(jsonResponse(200, body));
    await expect(
      client().importRecords(SESSION, { records: [] }),
    ).resolves.toEqual(body);
    expect(lastCall(fetchMock).url).toBe(`${API_BASE}${POCKET_ROUTES.import}`);
  });

  it("import: a response missing the mapping is malformed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { imported: [], skipped: [], records: [] }),
    );
    await expect(
      client().importRecords(SESSION, { records: [] }),
    ).rejects.toMatchObject({ failure: { kind: "malformed" } });
  });

  it("export: GETs the export route", async () => {
    const body = {
      exportedAt: "2026-09-05T00:00:00.000Z",
      records: [{ ...record, deletedAt: null }],
    };
    fetchMock.mockResolvedValue(jsonResponse(200, body));
    await expect(client().exportPocket(SESSION)).resolves.toEqual(body);
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.export}`);
    expect(call.init.method).toBe("GET");
  });

  it("deleteAll: DELETEs the pocket with the literal confirm phrase", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await client().deleteAll(SESSION);
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.pocket}`);
    expect(call.init.method).toBe("DELETE");
    expect(JSON.parse(call.init.body as string)).toEqual({
      confirm: "delete everything",
    });
  });

  it("surfaces the safe error code on a contracted rejection", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { status: "rejected", error: "session_invalid" }),
    );
    const error = await client()
      .listPocket(SESSION)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PocketClientError);
    expect((error as PocketClientError).failure).toEqual({
      kind: "http",
      httpStatus: 401,
      code: "session_invalid",
    });
    expect((error as PocketClientError).code).toBe("session_invalid");
  });

  it("classifies a thrown fetch as a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(client().listPocket(SESSION)).rejects.toMatchObject({
      failure: { kind: "network" },
    });
  });

  it("aborts after 8 s and classifies it as a timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = client().listPocket(SESSION);
    const assertion = expect(pending).rejects.toMatchObject({
      failure: { kind: "timeout" },
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("error messages never carry prompt text, tokens, or record ids", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { status: "boom" }));
    const error = await client()
      .createRecord(SESSION, {
        source: "personal",
        title: "T",
        category: "C",
        prompt: SECRET_PROMPT,
        localId: "test-local-2",
      })
      .then(
        () => null,
        (e: unknown) => e as PocketClientError,
      );
    expect(error?.message).not.toContain(SECRET_PROMPT);
    expect(error?.message).not.toContain(SESSION.sessionToken);

    fetchMock.mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const deleteError = await client()
      .deleteRecord(SESSION, record.id)
      .then(
        () => null,
        (e: unknown) => e as PocketClientError,
      );
    expect(deleteError?.message).not.toContain(record.id);
    expect(deleteError?.message).toContain("records.delete");
  });

  describe("promptRunV2", () => {
    it("POSTs { botKey, initData, target } with no session header and returns the typed body", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: "posted" }));
      const result = await client().promptRunV2(
        "auth_date=1&hash=x&query_id=q",
        {
          kind: "record",
          recordId: record.id,
        },
      );
      expect(result).toEqual({ status: "posted" });

      const call = lastCall(fetchMock);
      expect(call.url).toBe(`${API_BASE}${POCKET_ROUTES.promptRunV2}`);
      expect(JSON.parse(call.init.body as string)).toEqual({
        botKey: "hermes1",
        initData: "auth_date=1&hash=x&query_id=q",
        target: { kind: "record", recordId: record.id },
      });
      expect(Object.keys(JSON.parse(call.init.body as string))).toEqual([
        "botKey",
        "initData",
        "target",
      ]);
      expect(headersOf(call).authorization).toBeUndefined();
    });

    it("returns contracted non-2xx bodies as values, not exceptions", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, { status: "rejected", error: "unknown_bot" }),
      );
      await expect(
        client().promptRunV2("x", { kind: "catalog", cardId: "clear-email" }),
      ).resolves.toEqual({ status: "rejected", error: "unknown_bot" });

      fetchMock.mockResolvedValue(
        jsonResponse(503, { status: "dispatch_disabled" }),
      );
      await expect(
        client().promptRunV2("x", { kind: "catalog", cardId: "clear-email" }),
      ).resolves.toEqual({ status: "dispatch_disabled" });
    });

    it("treats an unknown status or rejection code as malformed", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: "surprise" }));
      await expect(
        client().promptRunV2("x", { kind: "catalog", cardId: "clear-email" }),
      ).rejects.toMatchObject({ failure: { kind: "malformed" } });

      fetchMock.mockResolvedValue(
        jsonResponse(400, { status: "rejected", error: "made_up" }),
      );
      await expect(
        client().promptRunV2("x", { kind: "catalog", cardId: "clear-email" }),
      ).rejects.toMatchObject({ failure: { kind: "malformed" } });
    });
  });
});
