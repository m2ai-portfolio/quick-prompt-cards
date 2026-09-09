import {
  POCKET_ROUTES,
  isValidBotKey,
  type CreateRecordRequest,
  type DispatchTarget,
  type ExportResponse,
  type ExportedPromptRecord,
  type ImportRequest,
  type ImportResponse,
  type PocketListResponse,
  type PromptRecord,
  type PromptRunV2Request,
  type PromptRunV2Response,
  type SessionRequest,
  type SessionResponse,
  type UpdateRecordRequest,
} from "../shared/pocket-contract";

/**
 * Read lazily (not cached at module load) so tests can stub the env var
 * per-case; in a real build Vite still inlines this at build time. A
 * trailing slash is dropped so `apiBase + POCKET_ROUTES.x` never doubles it.
 */
export function getPocketApiBase(): string | undefined {
  const raw = import.meta.env.VITE_PROMPT_POCKET_API_BASE;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

/** contracts/prompt-run-v1.md: "recommend 8s" bounded client-side timeout. */
export const POCKET_REQUEST_TIMEOUT_MS = 8000;

export type PocketSession = SessionResponse;

export type PocketClientFailure =
  /** fetch itself threw: offline, DNS, CORS, connection reset. */
  | { kind: "network" }
  /** No response within the bounded timeout. */
  | { kind: "timeout" }
  /** A response arrived but its body was not the contracted shape. */
  | { kind: "malformed"; httpStatus: number }
  /** A contracted rejection. `code` is the server's safe error code. */
  | { kind: "http"; httpStatus: number; code: string | null };

/**
 * The message names only a route LABEL and the failure kind. It never
 * carries a record id, prompt text, a token, or initData, so it is safe to
 * surface in the UI or a test log.
 */
export class PocketClientError extends Error {
  readonly route: string;
  readonly failure: PocketClientFailure;

  constructor(route: string, failure: PocketClientFailure) {
    super(`Pocket request "${route}" failed: ${describeFailure(failure)}`);
    this.name = "PocketClientError";
    this.route = route;
    this.failure = failure;
  }

  get code(): string | null {
    return this.failure.kind === "http" ? this.failure.code : null;
  }
}

function describeFailure(failure: PocketClientFailure): string {
  switch (failure.kind) {
    case "network":
      return "network error";
    case "timeout":
      return "timed out";
    case "malformed":
      return `malformed response (HTTP ${failure.httpStatus})`;
    case "http":
      return `${failure.code ?? "unknown_error"} (HTTP ${failure.httpStatus})`;
  }
}

export type UpdateRecordResult =
  { ok: true; record: PromptRecord } | { ok: false; conflict: PromptRecord };

export type PocketClient = {
  readonly apiBase: string;
  readonly botKey: string;
  createSession(initData: string): Promise<PocketSession>;
  logout(session: PocketSession): Promise<void>;
  listPocket(session: PocketSession): Promise<PocketListResponse>;
  createRecord(
    session: PocketSession,
    input: CreateRecordRequest,
  ): Promise<PromptRecord>;
  updateRecord(
    session: PocketSession,
    recordId: string,
    input: UpdateRecordRequest,
  ): Promise<UpdateRecordResult>;
  deleteRecord(session: PocketSession, recordId: string): Promise<void>;
  restoreRecord(
    session: PocketSession,
    recordId: string,
  ): Promise<PromptRecord>;
  importRecords(
    session: PocketSession,
    input: ImportRequest,
  ): Promise<ImportResponse>;
  exportPocket(session: PocketSession): Promise<ExportResponse>;
  deleteAll(session: PocketSession): Promise<void>;
  promptRunV2(
    initData: string,
    target: DispatchTarget,
  ): Promise<PromptRunV2Response>;
};

export type PocketClientConfig = {
  apiBase: string;
  botKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/* ---------- response shape guards (defensive, never trust the wire) ---------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPromptRecord(value: unknown): value is PromptRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.source === "personal" || value.source === "canonical-override") &&
    (value.canonicalCardId === null ||
      typeof value.canonicalCardId === "string") &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    typeof value.prompt === "string" &&
    typeof value.hidden === "boolean" &&
    typeof value.revision === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isExportedPromptRecord(value: unknown): value is ExportedPromptRecord {
  return (
    isPromptRecord(value) &&
    ((value as ExportedPromptRecord).deletedAt === null ||
      typeof (value as ExportedPromptRecord).deletedAt === "string")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isObject(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

const PROMPT_RUN_V2_STATUSES = new Set<PromptRunV2Response["status"]>([
  "posted",
  "already_posted",
  "rejected",
  "duplicate_in_progress",
  "already_consumed",
  "rate_limited",
  "telegram_error",
  "dispatch_disabled",
]);

const PROMPT_RUN_V2_REJECTIONS = new Set([
  "invalid_request",
  "unknown_bot",
  "invalid_init_data",
  "stale_init_data",
  "missing_query_id",
  "unknown_target",
  "prompt_too_long",
]);

function isPromptRunV2Response(value: unknown): value is PromptRunV2Response {
  if (!isObject(value) || typeof value.status !== "string") return false;
  if (
    !PROMPT_RUN_V2_STATUSES.has(value.status as PromptRunV2Response["status"])
  )
    return false;
  if (value.status === "rejected") {
    return (
      typeof value.error === "string" &&
      PROMPT_RUN_V2_REJECTIONS.has(value.error)
    );
  }
  return true;
}

/* ---------- transport ---------- */

type RawResponse = { status: number; body: unknown };

type RequestSpec = {
  /** Stable label for errors; never contains an id or user content. */
  label: string;
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  session?: PocketSession;
  body?: unknown;
};

export function createPocketClient(config: PocketClientConfig): PocketClient {
  if (!isValidBotKey(config.botKey)) {
    throw new Error(
      "A pocket client needs a bot key that matches the grammar.",
    );
  }
  const apiBase = config.apiBase.replace(/\/+$/, "");
  if (!apiBase) {
    throw new Error("A pocket client needs a non-empty API base.");
  }
  const botKey = config.botKey;
  const timeoutMs = config.timeoutMs ?? POCKET_REQUEST_TIMEOUT_MS;
  // Resolved per call so a test's `vi.stubGlobal("fetch")` after client
  // creation still takes effect; bound to globalThis so the real fetch
  // keeps its receiver.
  const doFetch: typeof fetch = (input, init) =>
    (config.fetchImpl ?? globalThis.fetch)(input, init);

  async function request(spec: RequestSpec): Promise<RawResponse> {
    const headers: Record<string, string> = { "x-bot-key": botKey };
    if (spec.body !== undefined) headers["content-type"] = "application/json";
    if (spec.session) {
      headers.authorization = `Bearer ${spec.session.sessionToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${apiBase}${spec.path}`, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      throw new PocketClientError(spec.label, {
        kind: aborted ? "timeout" : "network",
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return { status: 204, body: undefined };

    let body: unknown;
    try {
      const text = await response.text();
      body = text === "" ? undefined : JSON.parse(text);
    } catch {
      throw new PocketClientError(spec.label, {
        kind: "malformed",
        httpStatus: response.status,
      });
    }
    return { status: response.status, body };
  }

  /** Non-2xx: surface the safe error code; 2xx: hand back the body. */
  async function expectOk(spec: RequestSpec): Promise<RawResponse> {
    const raw = await request(spec);
    if (raw.status >= 200 && raw.status < 300) return raw;
    const code =
      isObject(raw.body) && typeof raw.body.error === "string"
        ? raw.body.error
        : isObject(raw.body) && typeof raw.body.status === "string"
          ? raw.body.status
          : null;
    throw new PocketClientError(spec.label, {
      kind: "http",
      httpStatus: raw.status,
      code,
    });
  }

  function malformed(label: string, status: number): PocketClientError {
    return new PocketClientError(label, {
      kind: "malformed",
      httpStatus: status,
    });
  }

  function recordFrom(label: string, raw: RawResponse): PromptRecord {
    if (isObject(raw.body) && isPromptRecord(raw.body.record)) {
      return raw.body.record;
    }
    throw malformed(label, raw.status);
  }

  return {
    apiBase,
    botKey,

    async createSession(initData) {
      const body: SessionRequest = { botKey, initData };
      const raw = await expectOk({
        label: "session",
        path: POCKET_ROUTES.session,
        method: "POST",
        body,
      });
      if (
        isObject(raw.body) &&
        typeof raw.body.sessionToken === "string" &&
        raw.body.sessionToken.length > 0 &&
        typeof raw.body.expiresAt === "string"
      ) {
        return {
          sessionToken: raw.body.sessionToken,
          expiresAt: raw.body.expiresAt,
        };
      }
      throw malformed("session", raw.status);
    },

    async logout(session) {
      await expectOk({
        label: "logout",
        path: POCKET_ROUTES.logout,
        method: "POST",
        session,
        body: {},
      });
    },

    async listPocket(session) {
      const raw = await expectOk({
        label: "pocket",
        path: POCKET_ROUTES.pocket,
        method: "GET",
        session,
      });
      if (
        isObject(raw.body) &&
        Array.isArray(raw.body.records) &&
        raw.body.records.every(isPromptRecord) &&
        isObject(raw.body.limits)
      ) {
        return raw.body as unknown as PocketListResponse;
      }
      throw malformed("pocket", raw.status);
    },

    async createRecord(session, input) {
      const raw = await expectOk({
        label: "records.create",
        path: POCKET_ROUTES.records,
        method: "POST",
        session,
        body: input,
      });
      return recordFrom("records.create", raw);
    },

    async updateRecord(session, recordId, input) {
      const label = "records.update";
      const raw = await request({
        label,
        path: POCKET_ROUTES.record(recordId),
        method: "PATCH",
        session,
        body: input,
      });
      if (raw.status === 409) {
        if (
          isObject(raw.body) &&
          raw.body.status === "revision_conflict" &&
          isPromptRecord(raw.body.current)
        ) {
          return { ok: false, conflict: raw.body.current };
        }
        throw malformed(label, raw.status);
      }
      if (raw.status < 200 || raw.status >= 300) {
        throw new PocketClientError(label, {
          kind: "http",
          httpStatus: raw.status,
          code:
            isObject(raw.body) && typeof raw.body.error === "string"
              ? raw.body.error
              : null,
        });
      }
      return { ok: true, record: recordFrom(label, raw) };
    },

    async deleteRecord(session, recordId) {
      await expectOk({
        label: "records.delete",
        path: POCKET_ROUTES.record(recordId),
        method: "DELETE",
        session,
      });
    },

    async restoreRecord(session, recordId) {
      const raw = await expectOk({
        label: "records.restore",
        path: POCKET_ROUTES.restore(recordId),
        method: "POST",
        session,
        body: {},
      });
      return recordFrom("records.restore", raw);
    },

    async importRecords(session, input) {
      const raw = await expectOk({
        label: "import",
        path: POCKET_ROUTES.import,
        method: "POST",
        session,
        body: input,
      });
      if (
        isObject(raw.body) &&
        isStringArray(raw.body.imported) &&
        isStringArray(raw.body.skipped) &&
        isStringMap(raw.body.mapping) &&
        Array.isArray(raw.body.records) &&
        raw.body.records.every(isPromptRecord)
      ) {
        return {
          imported: raw.body.imported,
          skipped: raw.body.skipped,
          mapping: raw.body.mapping,
          records: raw.body.records,
        };
      }
      throw malformed("import", raw.status);
    },

    async exportPocket(session) {
      const raw = await expectOk({
        label: "export",
        path: POCKET_ROUTES.export,
        method: "GET",
        session,
      });
      if (
        isObject(raw.body) &&
        typeof raw.body.exportedAt === "string" &&
        Array.isArray(raw.body.records) &&
        raw.body.records.every(isExportedPromptRecord)
      ) {
        return {
          exportedAt: raw.body.exportedAt,
          records: raw.body.records,
        };
      }
      throw malformed("export", raw.status);
    },

    async deleteAll(session) {
      await expectOk({
        label: "pocket.deleteAll",
        path: POCKET_ROUTES.pocket,
        method: "DELETE",
        session,
        body: { confirm: "delete everything" },
      });
    },

    async promptRunV2(initData, target) {
      const body: PromptRunV2Request = { botKey, initData, target };
      const raw = await request({
        label: "prompt-run.v2",
        path: POCKET_ROUTES.promptRunV2,
        method: "POST",
        body,
      });
      if (isPromptRunV2Response(raw.body)) return raw.body;
      throw malformed("prompt-run.v2", raw.status);
    },
  };
}
