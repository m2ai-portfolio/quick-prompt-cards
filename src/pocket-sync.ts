import type {
  CreateRecordRequest,
  DispatchTarget,
  ImportRequest,
  ImportResponse,
  PromptRecord,
  PromptRunV2Response,
  RecordSource,
  UpdateRecordRequest,
} from "../shared/pocket-contract";
import type { BotContext } from "./bot-context";
import {
  PocketClientError,
  createPocketClient,
  isPromptRecord,
  type PocketClient,
  type PocketSession,
} from "./pocket-client";
import type { Card, PromptCard } from "./types";
import {
  createAutomationStorage,
  type AutomationStorage,
} from "./workflows/wizard-state";

/**
 * Client half of contracts/shared-pocket-v1.md ("Client behavior").
 *
 * One store per page load. It decides, synchronously at creation, whether
 * this launch can sync at all (inside Telegram, strict bot key, API base,
 * signed initData, a user id to key the cache on). If any precondition
 * fails the store is `local-only` with the reason and the app behaves
 * exactly as before Phase 2. If they all pass, bootstrap() mints a session
 * and loads the pocket; a cached copy keyed by user id is shown while that
 * is in flight and kept as the offline fallback.
 *
 * Writes are server-first. A failed write is kept in `unsynced` with the
 * user's text and an explicit retry; nothing is ever written to the
 * pre-Phase-2 local stores while in pocket mode, so a failure can never
 * silently degrade into local-only. The unsynced queue is persisted in the
 * per-user cache blob, because Telegram closes the Mini App on every
 * successful dispatch and a failed write must survive that close.
 */

export type LocalOnlyReason =
  | "outside_telegram"
  | "no_bot_key"
  | "invalid_bot_key"
  | "no_api_base"
  | "no_init_data"
  | "no_user_id"
  /** Session mint got no usable answer: offline, timeout, 5xx, bad body. */
  | "session_failed"
  /** Session minted but GET /pocket got no usable answer. */
  | "load_failed"
  /**
   * The server answered and said no (4xx with a safe code, or 404 when v2
   * is rolled back). Retrying the same launch cannot succeed, so the UI
   * must label it honestly instead of "couldn't reach the server".
   */
  | "sync_rejected";

export type UnsyncedOp = "create" | "update" | "delete";

export type UnsyncedChange = {
  changeId: string;
  /** True once at least one attempt failed; false while an attempt runs. */
  error: boolean;
  /** Set when the last attempt lost a revision race; retry uses the new one. */
  conflict?: boolean;
} & (
  | { op: "create"; input: CreateRecordRequest }
  | {
      op: "update";
      recordId: string;
      input: Omit<UpdateRecordRequest, "revision">;
    }
  | { op: "delete"; recordId: string }
);

export type OfflineReason = "session_failed" | "load_failed" | "sync_rejected";

/**
 * Why the last sync attempt did not produce a live pocket. `code` is the
 * server's safe error code and is set only for `sync_rejected`; a 404 with
 * no contracted body (v2 routes rolled back) carries `not_found`.
 */
export type SyncFailure =
  | { reason: "session_failed" | "load_failed" }
  | { reason: "sync_rejected"; code: string | null };

export type PocketSyncState =
  | { mode: "booting"; userId: string }
  | { mode: "local-only"; reason: LocalOnlyReason; code?: string | null }
  | {
      mode: "pocket";
      userId: string;
      online: boolean;
      offlineReason: OfflineReason | null;
      offlineCode?: string | null;
      records: PromptRecord[];
      fromCache: boolean;
      unsynced: UnsyncedChange[];
      busy: number;
    };

/** True when a retry of the same launch could plausibly succeed. */
export function isRetryableFailure(
  reason: OfflineReason | LocalOnlyReason,
  code: string | null | undefined,
): boolean {
  if (reason === "session_failed" || reason === "load_failed") return true;
  return reason === "sync_rejected" && code === "rate_limited";
}

export type MigrationStatus = "done" | "dismissed" | null;

export type PocketSync = {
  getState(): PocketSyncState;
  subscribe(listener: () => void): () => void;
  /** Idempotent: concurrent callers share one in-flight bootstrap. */
  bootstrap(): Promise<void>;
  createRecord(input: CreateRecordRequest): Promise<boolean>;
  updateRecord(
    recordId: string,
    input: Omit<UpdateRecordRequest, "revision">,
  ): Promise<boolean>;
  deleteRecord(recordId: string): Promise<boolean>;
  retryChange(changeId: string): Promise<boolean>;
  discardChange(changeId: string): void;
  /** Raw import for the one-time local migration; does not touch state. */
  importLocal(input: ImportRequest): Promise<ImportResponse>;
  /** Fresh GET /pocket; replaces records and the cache. */
  reload(): Promise<PromptRecord[]>;
  /**
   * Transport for contracts/prompt-run-v2.md through the same client (same
   * API base, same bot key). Single-use bookkeeping stays in
   * telegram-actions.ts; this only sends. A catalog dispatch needs no
   * session, so this works whenever the launch carried a valid bot key and
   * an API base, even if the pocket session failed; it throws only when
   * there is no v2 client at all (no key or no API base).
   */
  promptRunV2(
    initData: string,
    target: DispatchTarget,
  ): Promise<PromptRunV2Response>;
  getMigrationStatus(): MigrationStatus;
  setMigrationStatus(status: Exclude<MigrationStatus, null>): void;
};

export type PocketSyncOptions = {
  botContext: BotContext;
  apiBase: string | undefined;
  telegram: TelegramWebApp | undefined;
  storage?: AutomationStorage;
  createClient?: (config: { apiBase: string; botKey: string }) => PocketClient;
  now?: () => number;
  nextChangeId?: () => string;
};

export function pocketCacheKeyFor(userId: string): string {
  return `prompt-pocket:pocket-cache:v1:${userId}`;
}

export function migrationKeyFor(userId: string): string {
  return `prompt-pocket:migration:v1:${userId}`;
}

type Launch = {
  botKey: string;
  apiBase: string;
  initData: string;
  userId: string;
};

type LaunchCheck =
  { ok: true; launch: Launch } | { ok: false; reason: LocalOnlyReason };

/**
 * The user id comes from `initDataUnsafe.user.id`. It is used ONLY as the
 * local cache and migration-flag key on this device; it is never sent (the
 * server derives ownership from the validated initData and returns no user
 * id, per contract). A forged id here can only mislabel this browser's own
 * cache.
 */
export function evaluateLaunch(
  options: Pick<PocketSyncOptions, "botContext" | "apiBase" | "telegram">,
): LaunchCheck {
  const { botContext, apiBase, telegram } = options;
  if (!telegram) return { ok: false, reason: "outside_telegram" };
  if (botContext.botKey === null) {
    return {
      ok: false,
      reason:
        botContext.reason === "missing" ? "no_bot_key" : "invalid_bot_key",
    };
  }
  if (!apiBase) return { ok: false, reason: "no_api_base" };
  if (!telegram.initData) return { ok: false, reason: "no_init_data" };
  const id = telegram.initDataUnsafe?.user?.id;
  if (typeof id !== "number" || !Number.isFinite(id)) {
    return { ok: false, reason: "no_user_id" };
  }
  return {
    ok: true,
    launch: {
      botKey: botContext.botKey,
      apiBase,
      initData: telegram.initData,
      userId: String(id),
    },
  };
}

const CACHE_VERSION = 1;

type CachedPocket = { records: PromptRecord[]; unsynced: UnsyncedChange[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCreateInput(value: unknown): value is CreateRecordRequest {
  return (
    isRecord(value) &&
    (value.source === "personal" || value.source === "canonical-override") &&
    (value.canonicalCardId === undefined ||
      typeof value.canonicalCardId === "string") &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    typeof value.prompt === "string" &&
    (value.hidden === undefined || typeof value.hidden === "boolean")
  );
}

function isUpdateInput(
  value: unknown,
): value is Omit<UpdateRecordRequest, "revision"> {
  return (
    isRecord(value) &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.category === undefined || typeof value.category === "string") &&
    (value.prompt === undefined || typeof value.prompt === "string") &&
    (value.hidden === undefined || typeof value.hidden === "boolean")
  );
}

/**
 * A persisted change is restored with `error: true`: whatever attempt was
 * in flight died with the page, so it needs an explicit retry either way.
 */
function restoreUnsyncedChange(value: unknown): UnsyncedChange | null {
  if (!isRecord(value) || typeof value.changeId !== "string") return null;
  const common = {
    changeId: value.changeId,
    error: true,
    conflict: value.conflict === true,
  };
  if (value.op === "create" && isCreateInput(value.input)) {
    return { ...common, op: "create", input: value.input };
  }
  if (
    value.op === "update" &&
    typeof value.recordId === "string" &&
    isUpdateInput(value.input)
  ) {
    return {
      ...common,
      op: "update",
      recordId: value.recordId,
      input: value.input,
    };
  }
  if (value.op === "delete" && typeof value.recordId === "string") {
    return { ...common, op: "delete", recordId: value.recordId };
  }
  return null;
}

function readCache(
  storage: AutomationStorage,
  userId: string,
): CachedPocket | null {
  const raw = storage.getItem(pocketCacheKeyFor(userId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      parsed.version === CACHE_VERSION &&
      Array.isArray(parsed.records) &&
      parsed.records.every(isPromptRecord)
    ) {
      // A change that no longer parses is dropped rather than poisoning the
      // whole cache; the records themselves are still valid server state.
      const unsynced = Array.isArray(parsed.unsynced)
        ? parsed.unsynced.flatMap((item) => {
            const change = restoreUnsyncedChange(item);
            return change ? [change] : [];
          })
        : [];
      return { records: parsed.records, unsynced };
    }
  } catch {
    // Corrupt cache: treat as absent and let a fresh load replace it.
  }
  storage.removeItem(pocketCacheKeyFor(userId));
  return null;
}

function writeCache(
  storage: AutomationStorage,
  userId: string,
  records: PromptRecord[],
  unsynced: UnsyncedChange[],
): void {
  storage.setItem(
    pocketCacheKeyFor(userId),
    JSON.stringify({
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      records,
      unsynced: unsynced.map((change) => ({ ...change, error: true })),
    }),
  );
}

/**
 * Classifies a failed bootstrap. An HTTP answer below 500 is the server
 * saying no to this launch (unknown bot, bad signature, v2 rolled back,
 * rate limit): the code is kept so the UI can say why. Everything else
 * (network, timeout, 5xx, malformed body) is "could not reach".
 */
function classifyBootstrapFailure(
  error: unknown,
  sessionMinted: boolean,
): SyncFailure {
  if (
    error instanceof PocketClientError &&
    error.failure.kind === "http" &&
    error.failure.httpStatus < 500
  ) {
    return {
      reason: "sync_rejected",
      code:
        error.failure.code ??
        (error.failure.httpStatus === 404 ? "not_found" : null),
    };
  }
  return { reason: sessionMinted ? "load_failed" : "session_failed" };
}

function defaultChangeId(): string {
  return `change-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Session is reused until shortly before its expiry, then re-minted. */
const SESSION_EXPIRY_MARGIN_MS = 30_000;

export function createPocketSync(options: PocketSyncOptions): PocketSync {
  const storage = options.storage ?? createAutomationStorage();
  const now = options.now ?? (() => Date.now());
  const nextChangeId = options.nextChangeId ?? defaultChangeId;
  const listeners = new Set<() => void>();

  const check = evaluateLaunch(options);
  let state: PocketSyncState = check.ok
    ? initialPocketState(check.launch.userId)
    : { mode: "local-only", reason: check.reason };

  function initialPocketState(userId: string): PocketSyncState {
    const cached = readCache(storage, userId);
    if (cached === null) return { mode: "booting", userId };
    return {
      mode: "pocket",
      userId,
      online: false,
      offlineReason: null,
      records: cached.records,
      fromCache: true,
      unsynced: cached.unsynced,
      busy: 1,
    };
  }

  // The v2 transport needs only a valid bot key and an API base
  // (contracts/prompt-run-v2.md: a catalog dispatch carries no session), so
  // it exists independently of the pocket preconditions. Pocket routes use
  // the same client but only when the whole launch check passed.
  const dispatchClient: PocketClient | null =
    options.botContext.botKey !== null && options.apiBase
      ? (options.createClient ?? createPocketClient)({
          apiBase: options.apiBase,
          botKey: options.botContext.botKey,
        })
      : null;
  const client: PocketClient | null = check.ok ? dispatchClient : null;
  const launch = check.ok ? check.launch : null;

  let session: PocketSession | null = null;
  let bootstrapPromise: Promise<void> | null = null;

  function setState(next: PocketSyncState): void {
    state = next;
    // Every pocket-mode state is mirrored to the per-user cache so that the
    // records AND the unsynced queue survive a Mini App close.
    if (next.mode === "pocket") {
      writeCache(storage, next.userId, next.records, next.unsynced);
    }
    listeners.forEach((listener) => listener());
  }

  function pocketState(): Extract<PocketSyncState, { mode: "pocket" }> | null {
    return state.mode === "pocket" ? state : null;
  }

  function requireClient(): { client: PocketClient; launch: Launch } {
    if (!client || !launch) {
      throw new Error("Pocket sync is in local-only mode.");
    }
    return { client, launch };
  }

  async function ensureSession(): Promise<PocketSession> {
    const { client, launch } = requireClient();
    if (
      session &&
      Date.parse(session.expiresAt) - SESSION_EXPIRY_MARGIN_MS > now()
    ) {
      return session;
    }
    session = await client.createSession(launch.initData);
    return session;
  }

  async function withSession<T>(
    call: (session: PocketSession, client: PocketClient) => Promise<T>,
  ): Promise<T> {
    const { client } = requireClient();
    const first = await ensureSession();
    try {
      return await call(first, client);
    } catch (error) {
      if (
        error instanceof PocketClientError &&
        error.code === "session_invalid"
      ) {
        // Expired or swept server-side: mint once more, then give up.
        session = null;
        const second = await ensureSession();
        return await call(second, client);
      }
      throw error;
    }
  }

  function commitRecords(records: PromptRecord[]): void {
    const current = pocketState();
    if (!current) return;
    setState({ ...current, records, fromCache: false });
  }

  async function runBootstrap(): Promise<void> {
    if (!check.ok || !launch) return;
    const userId = launch.userId;
    const cached = pocketState()?.records ?? null;

    let records: PromptRecord[];
    let failure: SyncFailure | null = null;
    try {
      session = null;
      records = (await withSession((s, c) => c.listPocket(s))).records;
    } catch (error) {
      // ensureSession() assigns `session` before the list call, so a null
      // session here means the mint itself failed.
      failure = classifyBootstrapFailure(error, session !== null);
      records = [];
    }

    if (failure === null) {
      const current = pocketState();
      setState({
        mode: "pocket",
        userId,
        online: true,
        offlineReason: null,
        records,
        fromCache: false,
        unsynced: current?.unsynced ?? [],
        busy: current ? Math.max(0, current.busy - 1) : 0,
      });
      return;
    }

    const code = failure.reason === "sync_rejected" ? failure.code : undefined;

    if (cached !== null) {
      const current = pocketState();
      setState({
        mode: "pocket",
        userId,
        online: false,
        offlineReason: failure.reason,
        ...(code !== undefined ? { offlineCode: code } : {}),
        records: cached,
        fromCache: true,
        unsynced: current?.unsynced ?? [],
        busy: current ? Math.max(0, current.busy - 1) : 0,
      });
      return;
    }

    setState({
      mode: "local-only",
      reason: failure.reason,
      ...(code !== undefined ? { code } : {}),
    });
  }

  function updateChange(
    changeId: string,
    patch: Partial<UnsyncedChange>,
  ): void {
    const current = pocketState();
    if (!current) return;
    setState({
      ...current,
      unsynced: current.unsynced.map((change) =>
        change.changeId === changeId
          ? ({ ...change, ...patch } as UnsyncedChange)
          : change,
      ),
    });
  }

  function removeChange(changeId: string): void {
    const current = pocketState();
    if (!current) return;
    setState({
      ...current,
      unsynced: current.unsynced.filter(
        (change) => change.changeId !== changeId,
      ),
    });
  }

  function adjustBusy(delta: number): void {
    const current = pocketState();
    if (!current) return;
    setState({ ...current, busy: Math.max(0, current.busy + delta) });
  }

  async function runChange(change: UnsyncedChange): Promise<boolean> {
    adjustBusy(1);
    try {
      const current = pocketState();
      if (!current) return false;

      if (change.op === "create") {
        const record = await withSession((s, c) =>
          c.createRecord(s, change.input),
        );
        removeChange(change.changeId);
        commitRecords(upsert(pocketState()?.records ?? [], record));
        return true;
      }

      if (change.op === "update") {
        const base = current.records.find((r) => r.id === change.recordId);
        if (!base) {
          // The record vanished (deleted from another device); nothing to
          // apply the edit to, so the change is dropped rather than retried.
          removeChange(change.changeId);
          return false;
        }
        const result = await withSession((s, c) =>
          c.updateRecord(s, change.recordId, {
            revision: base.revision,
            ...change.input,
          }),
        );
        if (result.ok) {
          removeChange(change.changeId);
          commitRecords(upsert(pocketState()?.records ?? [], result.record));
          return true;
        }
        // Lost a revision race: show the server's current text underneath,
        // keep the user's text on top, and let the next explicit retry win.
        commitRecords(upsert(pocketState()?.records ?? [], result.conflict));
        updateChange(change.changeId, { error: true, conflict: true });
        return false;
      }

      try {
        await withSession((s, c) => c.deleteRecord(s, change.recordId));
      } catch (error) {
        if (
          !(error instanceof PocketClientError) ||
          error.code !== "not_found"
        ) {
          throw error;
        }
        // Already gone server-side: the intent is satisfied.
      }
      removeChange(change.changeId);
      commitRecords(
        (pocketState()?.records ?? []).filter((r) => r.id !== change.recordId),
      );
      return true;
    } catch {
      updateChange(change.changeId, { error: true });
      return false;
    } finally {
      adjustBusy(-1);
    }
  }

  function enqueue(change: UnsyncedChange): Promise<boolean> {
    const current = pocketState();
    if (!current) return Promise.resolve(false);
    setState({ ...current, unsynced: [...current.unsynced, change] });
    return runChange(change);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrap() {
      if (!check.ok) return Promise.resolve();
      if (!bootstrapPromise) {
        bootstrapPromise = runBootstrap().finally(() => {
          bootstrapPromise = null;
        });
      }
      return bootstrapPromise;
    },
    createRecord(input) {
      return enqueue({
        changeId: nextChangeId(),
        op: "create",
        input,
        error: false,
      });
    },
    updateRecord(recordId, input) {
      return enqueue({
        changeId: nextChangeId(),
        op: "update",
        recordId,
        input,
        error: false,
      });
    },
    deleteRecord(recordId) {
      return enqueue({
        changeId: nextChangeId(),
        op: "delete",
        recordId,
        error: false,
      });
    },
    retryChange(changeId) {
      const change = pocketState()?.unsynced.find(
        (item) => item.changeId === changeId,
      );
      if (!change) return Promise.resolve(false);
      updateChange(changeId, { error: false, conflict: false });
      return runChange({ ...change, error: false, conflict: false });
    },
    discardChange(changeId) {
      removeChange(changeId);
    },
    importLocal(input) {
      return withSession((s, c) => c.importRecords(s, input));
    },
    async reload() {
      const list = await withSession((s, c) => c.listPocket(s));
      commitRecords(list.records);
      return list.records;
    },
    promptRunV2(initData, target) {
      if (!dispatchClient) {
        throw new Error("This launch has no bot key or API base to send with.");
      }
      return dispatchClient.promptRunV2(initData, target);
    },
    getMigrationStatus() {
      if (!launch) return null;
      const value = storage.getItem(migrationKeyFor(launch.userId));
      return value === "done" || value === "dismissed" ? value : null;
    },
    setMigrationStatus(status) {
      if (!launch) return;
      storage.setItem(migrationKeyFor(launch.userId), status);
    },
  };
}

function upsert(records: PromptRecord[], record: PromptRecord): PromptRecord[] {
  const index = records.findIndex((item) => item.id === record.id);
  if (index === -1) return [...records, record];
  return records.map((item, i) => (i === index ? record : item));
}

/* ---------- selectors (pure) ---------- */

export type PocketViewRecord = PromptRecord & {
  unsynced?: {
    changeId: string;
    op: UnsyncedOp;
    /** False while an attempt is in flight, true once one has failed. */
    error: boolean;
    conflict: boolean;
  };
};

/**
 * Server records with the user's unsynced edits laid on top: a failed
 * update shows the user's text, a failed delete keeps the record visible,
 * and a failed create appears as a draft whose id is its change id.
 */
export function selectPocketView(state: PocketSyncState): PocketViewRecord[] {
  if (state.mode !== "pocket") return [];
  const updates = new Map<string, Extract<UnsyncedChange, { op: "update" }>>();
  const deletes = new Map<string, Extract<UnsyncedChange, { op: "delete" }>>();
  const creates: Extract<UnsyncedChange, { op: "create" }>[] = [];
  for (const change of state.unsynced) {
    if (change.op === "update") updates.set(change.recordId, change);
    else if (change.op === "delete") deletes.set(change.recordId, change);
    else creates.push(change);
  }

  const base = state.records.map<PocketViewRecord>((record) => {
    const update = updates.get(record.id);
    if (update) {
      return {
        ...record,
        ...definedOnly(update.input),
        unsynced: {
          changeId: update.changeId,
          op: "update",
          error: update.error,
          conflict: Boolean(update.conflict),
        },
      };
    }
    const deletion = deletes.get(record.id);
    if (deletion) {
      return {
        ...record,
        unsynced: {
          changeId: deletion.changeId,
          op: "delete",
          error: deletion.error,
          conflict: false,
        },
      };
    }
    return record;
  });

  const drafts = creates.map<PocketViewRecord>((change) => ({
    id: change.changeId,
    source: change.input.source,
    canonicalCardId: change.input.canonicalCardId ?? null,
    title: change.input.title,
    category: change.input.category,
    prompt: change.input.prompt,
    hidden: change.input.hidden ?? false,
    revision: 0,
    createdAt: "",
    updatedAt: "",
    unsynced: {
      changeId: change.changeId,
      op: "create",
      error: change.error,
      conflict: false,
    },
  }));

  return [...base, ...drafts];
}

function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function recordsOfSource(
  records: PocketViewRecord[],
  source: RecordSource,
): PocketViewRecord[] {
  return records.filter((record) => record.source === source);
}

/** The canonical-override record for a starter card, if the user has one. */
export function findOverride(
  records: PocketViewRecord[],
  cardId: string,
): PocketViewRecord | undefined {
  return records.find(
    (record) =>
      record.source === "canonical-override" &&
      record.canonicalCardId === cardId,
  );
}

/**
 * Starter cards with the user's overrides applied. A hidden override
 * removes the card, except while that hide is still unsynced: the card
 * stays visible so the "Couldn't sync, try again" affordance has a home.
 */
export function applyPocketOverrides(
  cards: Card[],
  records: PocketViewRecord[],
): Card[] {
  return cards.flatMap<Card>((card) => {
    if (card.kind !== "prompt") return [card];
    const override = findOverride(records, card.id);
    if (!override) return [card];
    if (override.hidden && !override.unsynced) return [];
    const merged: PromptCard = {
      ...card,
      title: override.title,
      category: override.category,
      prompt: override.prompt,
    };
    return [merged];
  });
}
