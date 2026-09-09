import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  POCKET_ROUTES,
  isValidBotKey,
  type PocketErrorCode,
} from "../shared/pocket-contract.js";
import type { BotRegistry } from "./bot-registry.js";
import { validateInitDataIdentity } from "./init-data.js";
import type { PocketStore } from "./pocket-store.js";
import { PocketService } from "./pocket-service.js";
import {
  handlePromptRun,
  type PromptRunRequestBody,
} from "./prompt-run-handler.js";
import { handlePromptRunV2 } from "./prompt-run-v2-handler.js";
import { QueryClaimStore } from "./query-claim-store.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SessionService } from "./session.js";
import type { FetchLike } from "./telegram-client.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_RECORD_BODY_BYTES = 64 * 1024;
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_READ_TIMEOUT_MS = 10_000;
const PROMPT_RUN_PATH = POCKET_ROUTES.promptRunV1;
const DEFAULT_ALLOWED_ORIGIN = "https://m2ai-portfolio.github.io";
const RECORD_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const DISPATCH_RATE_LIMIT = 30;
const POCKET_RATE_LIMIT = 120;

/**
 * One line per request. Nothing else is ever logged about a request.
 * `error` is the outcome code for a non-success reply (the `error` field of a
 * rejection, otherwise the body's `status` word) and null on success, per
 * contracts/prompt-run-v2.md "Logging" (outcome status/error).
 */
export type RequestLogLine = {
  requestId: string;
  botKey: string | null;
  route: string;
  status: number;
  error: string | null;
  latencyMs: number;
};

export type PocketRuntimeOptions = {
  registry: BotRegistry;
  store: PocketStore;
  sessions?: SessionService;
  now?: () => number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  dispatchRateLimiter?: SlidingWindowRateLimiter;
  pocketRateLimiter?: SlidingWindowRateLimiter;
};

export type AppServerOptions = {
  /** TELEGRAM_BOT_TOKEN: serves the frozen v1 route only. Absent: v1 is 404. */
  v1BotToken?: string;
  allowedOrigin?: string;
  /** Absent: every v2 route is 404 and only /health plus v1 are served. */
  pocket?: PocketRuntimeOptions;
  log?: (line: RequestLogLine) => void;
  /** Body read timeout; default 10 s (contracts). Tests shorten it. */
  readTimeoutMs?: number;
};

type PocketRuntime = {
  registry: BotRegistry;
  store: PocketStore;
  sessions: SessionService;
  service: PocketService;
  dispatchRateLimiter: SlidingWindowRateLimiter;
  pocketRateLimiter: SlidingWindowRateLimiter;
  now: () => number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

type Route =
  | { name: "health" }
  | { name: "v1" }
  | { name: "session" }
  | { name: "logout" }
  | { name: "pocket-list" }
  | { name: "pocket-delete-all" }
  | { name: "record-create" }
  | { name: "record-update"; id: string }
  | { name: "record-delete"; id: string }
  | { name: "record-restore"; id: string }
  | { name: "import" }
  | { name: "export" }
  | { name: "prompt-run-v2" };

type Reply = {
  status: number;
  body?: unknown;
  /**
   * Answer, then close the connection instead of keeping it alive. Set when
   * the request body was not fully read (too large, or timed out) so a
   * keep-alive socket is never left with an unread body wedged in front of
   * the next request.
   */
  closeConnection?: boolean;
};

const NOT_FOUND: Reply = { status: 404, body: { status: "not_found" } };

function pocketError(code: PocketErrorCode, status: number): Reply {
  return { status, body: { status: "rejected", error: code } };
}

/**
 * Serves the frozen v1 route (contracts/prompt-run-v1.md), GET /health, and
 * the v2 surface (contracts/prompt-run-v2.md, contracts/shared-pocket-v1.md).
 * Dependency-free node:http. Bounded body sizes and read timeouts; unknown
 * body fields are rejected; one structured log line per request.
 */
export function createAppServer(options: AppServerOptions): Server {
  const allowedOrigin = options.allowedOrigin ?? DEFAULT_ALLOWED_ORIGIN;
  const log = options.log ?? (() => undefined);
  const claimStore = new QueryClaimStore();
  const runtime = options.pocket ? buildRuntime(options.pocket) : undefined;
  const readTimeoutMs = options.readTimeoutMs ?? REQUEST_READ_TIMEOUT_MS;

  return createServer((req, res) => {
    const startedAt = performance.now();
    const requestId = randomUUID();
    const context: { botKey: string | null; route: string } = {
      botKey: null,
      route: "unknown",
    };
    res.setHeader("x-request-id", requestId);
    applyCorsHeaders(req, res, allowedOrigin);

    const finish = (reply: Reply) => {
      respond(res, reply);
      log({
        requestId,
        botKey: context.botKey,
        route: context.route,
        status: reply.status,
        error: outcomeError(reply),
        latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
    };

    if (req.method === "OPTIONS") {
      context.route = "preflight";
      finish({ status: 204 });
      return;
    }

    const route = matchRoute(req.method ?? "", req.url ?? "/");
    if (!route) {
      finish(NOT_FOUND);
      return;
    }
    context.route = routeLabel(route);

    dispatch(route, req, context, {
      v1BotToken: options.v1BotToken,
      claimStore,
      runtime,
      readTimeoutMs,
    })
      .then(finish)
      .catch(() => finish({ status: 500, body: { status: "internal_error" } }));
  });
}

/** v1-compatible constructor kept for the frozen route and its tests. */
export function createPromptRunServer(
  botToken: string,
  allowedOrigin: string = DEFAULT_ALLOWED_ORIGIN,
): Server {
  return createAppServer({ v1BotToken: botToken, allowedOrigin });
}

function buildRuntime(options: PocketRuntimeOptions): PocketRuntime {
  const now = options.now ?? Date.now;
  return {
    registry: options.registry,
    store: options.store,
    sessions: options.sessions ?? new SessionService(options.store, { now }),
    service: new PocketService(options.store, { now }),
    dispatchRateLimiter:
      options.dispatchRateLimiter ??
      new SlidingWindowRateLimiter({
        limit: DISPATCH_RATE_LIMIT,
        windowMs: TEN_MINUTES_MS,
        clock: now,
      }),
    pocketRateLimiter:
      options.pocketRateLimiter ??
      new SlidingWindowRateLimiter({
        limit: POCKET_RATE_LIMIT,
        windowMs: TEN_MINUTES_MS,
        clock: now,
      }),
    now,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  };
}

function matchRoute(method: string, rawUrl: string): Route | undefined {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return undefined;
  }

  if (method === "GET" && pathname === POCKET_ROUTES.health) {
    return { name: "health" };
  }
  if (method === "POST" && pathname === PROMPT_RUN_PATH) {
    return { name: "v1" };
  }
  if (method === "POST" && pathname === POCKET_ROUTES.session) {
    return { name: "session" };
  }
  if (method === "POST" && pathname === POCKET_ROUTES.logout) {
    return { name: "logout" };
  }
  if (pathname === POCKET_ROUTES.pocket) {
    if (method === "GET") return { name: "pocket-list" };
    if (method === "DELETE") return { name: "pocket-delete-all" };
    return undefined;
  }
  if (method === "POST" && pathname === POCKET_ROUTES.records) {
    return { name: "record-create" };
  }
  if (method === "POST" && pathname === POCKET_ROUTES.import) {
    return { name: "import" };
  }
  if (method === "GET" && pathname === POCKET_ROUTES.export) {
    return { name: "export" };
  }
  if (method === "POST" && pathname === POCKET_ROUTES.promptRunV2) {
    return { name: "prompt-run-v2" };
  }

  const prefix = `${POCKET_ROUTES.records}/`;
  if (pathname.startsWith(prefix)) {
    const rest = pathname.slice(prefix.length).split("/");
    const id = decodeRecordId(rest[0]);
    if (id === undefined) return undefined;
    if (rest.length === 1) {
      if (method === "PATCH") return { name: "record-update", id };
      if (method === "DELETE") return { name: "record-delete", id };
      return undefined;
    }
    if (rest.length === 2 && rest[1] === "restore" && method === "POST") {
      return { name: "record-restore", id };
    }
  }
  return undefined;
}

function decodeRecordId(segment: string | undefined): string | undefined {
  if (!segment) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return RECORD_ID_PATTERN.test(decoded) ? decoded : undefined;
}

function routeLabel(route: Route): string {
  switch (route.name) {
    case "health":
      return POCKET_ROUTES.health;
    case "v1":
      return POCKET_ROUTES.promptRunV1;
    case "session":
      return POCKET_ROUTES.session;
    case "logout":
      return POCKET_ROUTES.logout;
    case "pocket-list":
    case "pocket-delete-all":
      return POCKET_ROUTES.pocket;
    case "record-create":
      return POCKET_ROUTES.records;
    case "record-update":
    case "record-delete":
      return `${POCKET_ROUTES.records}/:id`;
    case "record-restore":
      return `${POCKET_ROUTES.records}/:id/restore`;
    case "import":
      return POCKET_ROUTES.import;
    case "export":
      return POCKET_ROUTES.export;
    case "prompt-run-v2":
      return POCKET_ROUTES.promptRunV2;
  }
}

type DispatchDeps = {
  v1BotToken: string | undefined;
  claimStore: QueryClaimStore;
  runtime: PocketRuntime | undefined;
  readTimeoutMs: number;
};

/** Outcome code for the log line: null on success, the code otherwise. */
function outcomeError(reply: Reply): string | null {
  if (reply.status < 400) return null;
  const body = reply.body as { error?: unknown; status?: unknown } | undefined;
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.status === "string") return body.status;
  return null;
}

async function dispatch(
  route: Route,
  req: IncomingMessage,
  context: { botKey: string | null },
  deps: DispatchDeps,
): Promise<Reply> {
  const { v1BotToken, claimStore, runtime, readTimeoutMs } = deps;
  if (route.name === "health") {
    return { status: 200, body: { status: "ok" } };
  }

  if (route.name === "v1") {
    if (!v1BotToken) return NOT_FOUND;
    return handleV1(req, v1BotToken, claimStore, readTimeoutMs);
  }

  if (!runtime) return NOT_FOUND;

  if (route.name === "session") {
    return handleSession(req, context, runtime, readTimeoutMs);
  }
  if (route.name === "prompt-run-v2") {
    return handleDispatchV2(req, context, runtime, claimStore, readTimeoutMs);
  }

  const auth = authenticate(req, context, runtime);
  if (!auth.ok) return auth.reply;
  const owner = auth.userId;
  const { service } = runtime;

  switch (route.name) {
    case "logout":
      runtime.sessions.logout(auth.token);
      return { status: 204 };
    case "pocket-list":
      return { status: 200, body: service.list(owner) };
    case "export":
      return { status: 200, body: service.export(owner) };
    case "record-delete":
      return mapService(service.delete(owner, route.id), () => ({
        status: 204,
      }));
    case "record-restore":
      return mapService(service.restore(owner, route.id), (result) => ({
        status: 200,
        body: { record: result.record },
      }));
    case "record-create": {
      const body = await readV2Body(req, MAX_RECORD_BODY_BYTES, readTimeoutMs);
      if (!body.ok) return body.reply;
      return mapService(service.create(owner, body.value), (result) => ({
        status: 200,
        body: { record: result.record },
      }));
    }
    case "record-update": {
      const body = await readV2Body(req, MAX_RECORD_BODY_BYTES, readTimeoutMs);
      if (!body.ok) return body.reply;
      const result = service.update(owner, route.id, body.value);
      if (!result.ok && result.error === "revision_conflict") {
        return {
          status: 409,
          body: { status: "revision_conflict", current: result.current },
        };
      }
      return mapService(result, (updated) => ({
        status: 200,
        body: { record: updated.record },
      }));
    }
    case "import": {
      const body = await readV2Body(req, MAX_IMPORT_BODY_BYTES, readTimeoutMs);
      if (!body.ok) return body.reply;
      return mapService(service.import(owner, body.value), (result) => ({
        status: 200,
        body: result.response,
      }));
    }
    case "pocket-delete-all": {
      const body = await readV2Body(req, MAX_BODY_BYTES, readTimeoutMs);
      if (!body.ok) return body.reply;
      return mapService(service.deleteAll(owner, body.value), () => ({
        status: 204,
      }));
    }
  }
}

type ServiceOutcome =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "limit_exceeded"
        | "not_found"
        | "revision_conflict";
    };

function mapService<R extends ServiceOutcome>(
  result: R,
  onSuccess: (value: Extract<R, { ok: true }>) => Reply,
): Reply {
  if (result.ok) return onSuccess(result as Extract<R, { ok: true }>);
  switch ((result as Extract<R, { ok: false }>).error) {
    case "not_found":
      return pocketError("not_found", 404);
    case "limit_exceeded":
      return pocketError("limit_exceeded", 400);
    default:
      return pocketError("invalid_request", 400);
  }
}

async function handleV1(
  req: IncomingMessage,
  botToken: string,
  claimStore: QueryClaimStore,
  readTimeoutMs: number,
): Promise<Reply> {
  let body: PromptRunRequestBody;
  try {
    body = (await readJsonBody(
      req,
      MAX_BODY_BYTES,
      readTimeoutMs,
    )) as PromptRunRequestBody;
  } catch (error) {
    return {
      status: 400,
      body: { status: "rejected", error: "invalid_init_data" },
      closeConnection: bodyLeftUnread(error),
    };
  }
  const result = await handlePromptRun(body, { botToken, claimStore });
  return { status: result.httpStatus, body: result.body };
}

async function handleSession(
  req: IncomingMessage,
  context: { botKey: string | null },
  runtime: PocketRuntime,
  readTimeoutMs: number,
): Promise<Reply> {
  const body = await readV2Body(req, MAX_BODY_BYTES, readTimeoutMs);
  if (!body.ok) return body.reply;
  const value = body.value;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, ["botKey", "initData"])
  ) {
    return pocketError("invalid_request", 400);
  }
  const { botKey, initData } = value as Record<string, unknown>;
  if (typeof botKey !== "string" || typeof initData !== "string") {
    return pocketError("invalid_request", 400);
  }
  if (isValidBotKey(botKey)) context.botKey = botKey;

  const bot = runtime.registry.resolve(botKey);
  if (!bot) return pocketError("unknown_bot", 400);

  const identity = validateInitDataIdentity(
    initData,
    bot.token,
    Math.floor(runtime.now() / 1000),
    { requireQueryId: false },
  );
  if (!identity.ok) {
    const code: PocketErrorCode =
      identity.error === "stale_init_data"
        ? "stale_init_data"
        : "invalid_init_data";
    return pocketError(code, 400);
  }

  // Minting is the one unauthenticated write. It counts against the same
  // per-user pocket budget as every other pocket request, so one signed
  // launch cannot mint unbounded 24-hour session rows.
  if (!runtime.pocketRateLimiter.hit(String(identity.userId))) {
    return pocketError("rate_limited", 429);
  }

  const minted = runtime.sessions.mint(identity.userId, bot.key);
  return { status: 200, body: minted };
}

async function handleDispatchV2(
  req: IncomingMessage,
  context: { botKey: string | null },
  runtime: PocketRuntime,
  claimStore: QueryClaimStore,
  readTimeoutMs: number,
): Promise<Reply> {
  const body = await readV2Body(req, MAX_BODY_BYTES, readTimeoutMs);
  if (!body.ok) return body.reply;
  const candidate = (body.value as { botKey?: unknown } | null)?.botKey;
  if (isValidBotKey(candidate)) context.botKey = candidate;

  const result = await handlePromptRunV2(body.value, {
    registry: runtime.registry,
    store: runtime.store,
    claimStore,
    rateLimiter: runtime.dispatchRateLimiter,
    fetchImpl: runtime.fetchImpl,
    now: runtime.now,
    timeoutMs: runtime.timeoutMs,
  });
  return { status: result.httpStatus, body: result.body };
}

function authenticate(
  req: IncomingMessage,
  context: { botKey: string | null },
  runtime: PocketRuntime,
): { ok: true; userId: number; token: string } | { ok: false; reply: Reply } {
  const invalidSession = {
    ok: false as const,
    reply: pocketError("session_invalid", 401),
  };

  const botKeyHeader = req.headers["x-bot-key"];
  if (!isValidBotKey(botKeyHeader)) return invalidSession;
  context.botKey = botKeyHeader;
  // A bot removed from the allowlist takes its sessions with it.
  if (!runtime.registry.resolve(botKeyHeader)) return invalidSession;

  const authorization = req.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return invalidSession;
  }
  const token = authorization.slice("Bearer ".length).trim();
  const verified = runtime.sessions.verify(token, botKeyHeader);
  if (!verified.ok) return invalidSession;

  if (!runtime.pocketRateLimiter.hit(String(verified.userId))) {
    return { ok: false, reply: pocketError("rate_limited", 429) };
  }
  return { ok: true, userId: verified.userId, token };
}

function exactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const present = Object.keys(obj);
  return present.length === keys.length && keys.every((key) => key in obj);
}

async function readV2Body(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reply: Reply }> {
  try {
    const value = await readJsonBody(req, maxBytes, timeoutMs);
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      reply: {
        ...pocketError("invalid_request", 400),
        closeConnection: bodyLeftUnread(error),
      },
    };
  }
}

class BodyReadError extends Error {
  constructor(readonly kind: "payload_too_large" | "request_timeout") {
    super(kind);
    this.name = "BodyReadError";
  }
}

/** True when the request body was abandoned mid-stream (not a parse error). */
function bodyLeftUnread(error: unknown): boolean {
  return error instanceof BodyReadError;
}

function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigin: string,
): void {
  const origin = req.headers.origin;
  // Always: a cache must not serve one origin's CORS answer to another, and
  // the no-allow-origin answer must not be served to the allowed origin.
  res.setHeader("vary", "origin");
  if (origin !== allowedOrigin) {
    return;
  }
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-bot-key",
  );
  res.setHeader("access-control-max-age", "600");
}

function respond(res: ServerResponse, reply: Reply): void {
  if (reply.closeConnection) res.setHeader("connection", "close");
  if (reply.body === undefined) {
    res.writeHead(reply.status).end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Reads and parses a JSON body. Too large or too slow rejects with a
 * BodyReadError and STOPS reading; the caller answers with `Connection:
 * close`, so the client sees the 400 on the wire (the socket is not destroyed
 * before the reply) and the unread remainder can never wedge a keep-alive
 * connection (Node closes the socket after the reply is flushed).
 */
function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const abandon = (kind: BodyReadError["kind"]) => {
      clearTimeout(timer);
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.pause();
      reject(new BodyReadError(kind));
    };
    const timer = setTimeout(() => abandon("request_timeout"), timeoutMs);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        abandon("payload_too_large");
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
