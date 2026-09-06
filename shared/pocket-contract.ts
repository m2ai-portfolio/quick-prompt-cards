/**
 * Wire types shared by the browser client and the Node server for
 * contracts/prompt-run-v2.md and contracts/shared-pocket-v1.md. This file is
 * the single source of truth for request/response shapes; both sides import
 * it and neither side may add fields the contracts do not list.
 *
 * Nothing in this file may ever carry a bot token, raw initData beyond the
 * request field that transports it, or an owner user id on the wire.
 */

export const POCKET_CONTRACT = "shared-pocket/v1" as const;
export const PROMPT_RUN_V2_CONTRACT = "prompt-run/v2" as const;

/** Public bot key grammar (contracts/prompt-run-v2.md, "Bot registry"). */
export const BOT_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export const POCKET_LIMITS = {
  maxRecordsPerUser: 200,
  maxPromptBytes: 8 * 1024,
  maxTitleChars: 120,
  maxCategoryChars: 40,
  sessionTtlMs: 24 * 60 * 60 * 1000,
  softDeleteRetentionDays: 30,
} as const;

export type RecordSource = "personal" | "canonical-override";

/** A prompt record as it appears on the wire. Never includes the owner id. */
export type PromptRecord = {
  id: string;
  source: RecordSource;
  canonicalCardId: string | null;
  title: string;
  category: string;
  prompt: string;
  hidden: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ExportedPromptRecord = PromptRecord & { deletedAt: string | null };

/* ---------- session ---------- */

export type SessionRequest = { botKey: string; initData: string };
export type SessionResponse = { sessionToken: string; expiresAt: string };

/* ---------- pocket ---------- */

export type PocketListResponse = {
  records: PromptRecord[];
  limits: typeof POCKET_LIMITS;
};

export type CreateRecordRequest = {
  source: RecordSource;
  canonicalCardId?: string;
  title: string;
  category: string;
  prompt: string;
  hidden?: boolean;
};

export type UpdateRecordRequest = {
  revision: number;
  title?: string;
  category?: string;
  prompt?: string;
  hidden?: boolean;
};

export type RecordResponse = { record: PromptRecord };
export type RevisionConflictResponse = {
  status: "revision_conflict";
  current: PromptRecord;
};

/** A record as held in browser storage before import (client-generated id). */
export type LocalRecord = {
  localId: string;
  source: RecordSource;
  canonicalCardId?: string;
  title: string;
  category: string;
  prompt: string;
  hidden?: boolean;
};

export type ImportRequest = { records: LocalRecord[] };
export type ImportResponse = {
  /** localIds that created a new record */
  imported: string[];
  /** localIds that matched an existing record (dedupe) */
  skipped: string[];
  /** localId -> server record id, for every input */
  mapping: Record<string, string>;
  records: PromptRecord[];
};

export type ExportResponse = {
  exportedAt: string;
  records: ExportedPromptRecord[];
};

export type DeletePocketRequest = { confirm: "delete everything" };

export type PocketErrorCode =
  | "invalid_request"
  | "unknown_bot"
  | "invalid_init_data"
  | "stale_init_data"
  | "session_invalid"
  | "not_found"
  | "limit_exceeded"
  | "rate_limited";

export type PocketErrorResponse = {
  status: "rejected";
  error: PocketErrorCode;
};

/* ---------- dispatch v2 ---------- */

export type DispatchTarget =
  { kind: "catalog"; cardId: string } | { kind: "record"; recordId: string };

export type PromptRunV2Request = {
  botKey: string;
  initData: string;
  target: DispatchTarget;
};

export type PromptRunV2Rejection =
  | "invalid_request"
  | "unknown_bot"
  | "invalid_init_data"
  | "stale_init_data"
  | "missing_query_id"
  | "unknown_target";

export type PromptRunV2Response =
  | { status: "posted" }
  | { status: "already_posted" }
  | { status: "rejected"; error: PromptRunV2Rejection }
  | { status: "duplicate_in_progress" }
  | { status: "already_consumed" }
  | { status: "rate_limited" }
  | { status: "telegram_error" }
  | { status: "dispatch_disabled" };

/** Route table, so client and server agree on paths without string drift. */
export const POCKET_ROUTES = {
  session: "/api/v2/session",
  logout: "/api/v2/session/logout",
  pocket: "/api/v2/pocket",
  records: "/api/v2/pocket/records",
  record: (id: string) => `/api/v2/pocket/records/${encodeURIComponent(id)}`,
  restore: (id: string) =>
    `/api/v2/pocket/records/${encodeURIComponent(id)}/restore`,
  import: "/api/v2/pocket/import",
  export: "/api/v2/pocket/export",
  promptRunV2: "/api/v2/prompt-run",
  promptRunV1: "/api/prompt-run",
  health: "/health",
} as const;

export function isValidBotKey(value: unknown): value is string {
  return typeof value === "string" && BOT_KEY_PATTERN.test(value);
}
