import {
  POCKET_LIMITS,
  type ExportResponse,
  type ImportResponse,
  type LocalRecord,
  type PocketListResponse,
  type PromptRecord,
  type RecordSource,
} from "../shared/pocket-contract.js";
import type {
  PocketStore,
  RecordContent,
  RecordPatch,
} from "./pocket-store.js";

export type ServiceFailure = "invalid_request" | "limit_exceeded" | "not_found";

export type ServiceResult<T> =
  ({ ok: true } & T) | { ok: false; error: ServiceFailure };

export type UpdateResult =
  | { ok: true; record: PromptRecord }
  | { ok: false; error: ServiceFailure }
  | { ok: false; error: "revision_conflict"; current: PromptRecord };

type FieldCheck<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalid_request" | "limit_exceeded" };

const SOURCES: readonly RecordSource[] = ["personal", "canonical-override"];
const CREATE_KEYS = [
  "source",
  "canonicalCardId",
  "title",
  "category",
  "prompt",
  "hidden",
  "localId",
];
const UPDATE_KEYS = ["revision", "title", "category", "prompt", "hidden"];
const LOCAL_RECORD_KEYS = ["localId", ...CREATE_KEYS];
const MAX_CANONICAL_CARD_ID_CHARS = 120;
const MAX_LOCAL_ID_CHARS = 200;

function invalid(): { ok: false; error: "invalid_request" } {
  return { ok: false, error: "invalid_request" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every((key) => allowed.includes(key));
}

function charCount(value: string): number {
  return Array.from(value).length;
}

function checkTitle(value: unknown): FieldCheck<string> {
  if (typeof value !== "string") return invalid();
  const title = value.trim();
  if (title.length === 0) return invalid();
  if (charCount(title) > POCKET_LIMITS.maxTitleChars) {
    return { ok: false, error: "limit_exceeded" };
  }
  return { ok: true, value: title };
}

function checkCategory(value: unknown): FieldCheck<string> {
  if (typeof value !== "string") return invalid();
  const category = value.trim();
  if (charCount(category) > POCKET_LIMITS.maxCategoryChars) {
    return { ok: false, error: "limit_exceeded" };
  }
  return { ok: true, value: category };
}

function checkPrompt(value: unknown): FieldCheck<string> {
  if (typeof value !== "string" || value.trim().length === 0) return invalid();
  if (Buffer.byteLength(value, "utf8") > POCKET_LIMITS.maxPromptBytes) {
    return { ok: false, error: "limit_exceeded" };
  }
  return { ok: true, value };
}

function checkHidden(value: unknown): FieldCheck<boolean | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "boolean") return invalid();
  return { ok: true, value };
}

function checkSource(value: unknown): FieldCheck<RecordSource> {
  if (typeof value !== "string" || !SOURCES.includes(value as RecordSource)) {
    return invalid();
  }
  return { ok: true, value: value as RecordSource };
}

function checkCanonicalCardId(
  source: RecordSource,
  value: unknown,
): FieldCheck<string | null> {
  if (source === "personal") {
    return value === undefined ? { ok: true, value: null } : invalid();
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    charCount(value) > MAX_CANONICAL_CARD_ID_CHARS
  ) {
    return invalid();
  }
  return { ok: true, value: value.trim() };
}

type ValidatedContent = RecordContent & {
  source: RecordSource;
  canonicalCardId: string | null;
};

function checkLocalId(value: unknown): FieldCheck<string> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LOCAL_ID_CHARS
  ) {
    return invalid();
  }
  return { ok: true, value: value };
}

function checkRecordBody(
  body: Record<string, unknown>,
): FieldCheck<ValidatedContent> {
  const source = checkSource(body.source);
  if (!source.ok) return source;
  const canonicalCardId = checkCanonicalCardId(
    source.value,
    body.canonicalCardId,
  );
  if (!canonicalCardId.ok) return canonicalCardId;
  const title = checkTitle(body.title);
  if (!title.ok) return title;
  const category = checkCategory(body.category);
  if (!category.ok) return category;
  const prompt = checkPrompt(body.prompt);
  if (!prompt.ok) return prompt;
  const hidden = checkHidden(body.hidden);
  if (!hidden.ok) return hidden;
  return {
    ok: true,
    value: {
      source: source.value,
      canonicalCardId: canonicalCardId.value,
      title: title.value,
      category: category.value,
      prompt: prompt.value,
      hidden: hidden.value ?? false,
    },
  };
}

/**
 * Owner-scoped pocket operations for contracts/shared-pocket-v1.md. Every
 * method takes the owner id derived from a verified session; the store adds
 * it to every SQL statement. Validation happens here, before any write.
 */
export class PocketService {
  private readonly store: PocketStore;
  private readonly now: () => number;

  constructor(store: PocketStore, options: { now?: () => number } = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  list(owner: number): PocketListResponse {
    return { records: this.store.listRecords(owner), limits: POCKET_LIMITS };
  }

  create(
    owner: number,
    body: unknown,
  ): ServiceResult<{ record: PromptRecord }> {
    if (!isPlainObject(body) || !hasOnlyKeys(body, CREATE_KEYS)) {
      return invalid();
    }
    // localId is the client-generated idempotency key: mandatory, deduped
    // per owner below (contracts/shared-pocket-v1.md, amendment 2026-09-09).
    const localId = checkLocalId(body.localId);
    if (!localId.ok) return localId;
    const checked = checkRecordBody(body);
    if (!checked.ok) return checked;
    const fields = checked.value;
    const nowIso = this.nowIso();

    return this.store.transaction(() => {
      // A retried create (timeout + retry, Mini App close + reopen) maps to
      // the record the first attempt made: never a second pin.
      const existingId = this.store.findCreateIdempotency(owner, localId.value);
      if (existingId !== undefined) {
        const existing = this.store.getIdempotentRecord(owner, existingId);
        if (existing) return { ok: true, record: existing };
      }
      if (fields.canonicalCardId !== null) {
        const existing = this.store.findByCanonicalCardId(
          owner,
          fields.canonicalCardId,
        );
        if (existing && existing.deletedAt === null) {
          const { deletedAt: _deletedAt, ...record } = existing;
          void _deletedAt;
          return { ok: true, record };
        }
        if (existing) {
          if (
            this.store.countActiveRecords(owner) >=
            POCKET_LIMITS.maxRecordsPerUser
          ) {
            return { ok: false, error: "limit_exceeded" };
          }
          const revived = this.store.reviveRecord(
            owner,
            existing.id,
            fields,
            nowIso,
          );
          return revived ? { ok: true, record: revived } : invalid();
        }
      }
      if (
        this.store.countActiveRecords(owner) >= POCKET_LIMITS.maxRecordsPerUser
      ) {
        return { ok: false, error: "limit_exceeded" };
      }
      const record = this.store.insertRecord(owner, fields, nowIso);
      this.store.rememberCreateIdempotency(
        owner,
        localId.value,
        record.id,
        nowIso,
      );
      return { ok: true, record };
    });
  }

  update(owner: number, id: string, body: unknown): UpdateResult {
    if (!isPlainObject(body) || !hasOnlyKeys(body, UPDATE_KEYS)) {
      return invalid();
    }
    const revision = body.revision;
    if (
      typeof revision !== "number" ||
      !Number.isInteger(revision) ||
      revision < 1
    ) {
      return invalid();
    }
    const patch: RecordPatch = {};
    if (body.title !== undefined) {
      const title = checkTitle(body.title);
      if (!title.ok) return title;
      patch.title = title.value;
    }
    if (body.category !== undefined) {
      const category = checkCategory(body.category);
      if (!category.ok) return category;
      patch.category = category.value;
    }
    if (body.prompt !== undefined) {
      const prompt = checkPrompt(body.prompt);
      if (!prompt.ok) return prompt;
      patch.prompt = prompt.value;
    }
    if (body.hidden !== undefined) {
      const hidden = checkHidden(body.hidden);
      if (!hidden.ok) return hidden;
      patch.hidden = hidden.value;
    }
    if (Object.keys(patch).length === 0) return invalid();

    const outcome = this.store.updateRecord(
      owner,
      id,
      revision,
      patch,
      this.nowIso(),
    );
    if (outcome.outcome === "updated")
      return { ok: true, record: outcome.record };
    if (outcome.outcome === "conflict") {
      return {
        ok: false,
        error: "revision_conflict",
        current: outcome.current,
      };
    }
    return { ok: false, error: "not_found" };
  }

  delete(owner: number, id: string): ServiceResult<object> {
    return this.store.softDeleteRecord(owner, id, this.nowIso())
      ? { ok: true }
      : { ok: false, error: "not_found" };
  }

  restore(owner: number, id: string): ServiceResult<{ record: PromptRecord }> {
    const record = this.store.restoreRecord(
      owner,
      id,
      this.nowIso(),
      POCKET_LIMITS.softDeleteRetentionDays,
    );
    return record ? { ok: true, record } : { ok: false, error: "not_found" };
  }

  import(
    owner: number,
    body: unknown,
  ): ServiceResult<{ response: ImportResponse }> {
    if (!isPlainObject(body) || !hasOnlyKeys(body, ["records"]))
      return invalid();
    if (!Array.isArray(body.records)) return invalid();

    const normalized: LocalRecord[] = [];
    const seenLocalIds = new Set<string>();
    for (const item of body.records) {
      if (!isPlainObject(item) || !hasOnlyKeys(item, LOCAL_RECORD_KEYS)) {
        return invalid();
      }
      const localId = item.localId;
      if (
        typeof localId !== "string" ||
        localId.length === 0 ||
        localId.length > MAX_LOCAL_ID_CHARS ||
        seenLocalIds.has(localId)
      ) {
        return invalid();
      }
      seenLocalIds.add(localId);
      const checked = checkRecordBody(item);
      if (!checked.ok) return checked;
      const { canonicalCardId, ...rest } = checked.value;
      normalized.push({
        localId,
        ...rest,
        ...(canonicalCardId === null ? {} : { canonicalCardId }),
      });
    }

    const outcome = this.store.importRecords(
      owner,
      normalized,
      this.nowIso(),
      POCKET_LIMITS.maxRecordsPerUser,
    );
    if (outcome.outcome === "limit_exceeded") {
      return { ok: false, error: "limit_exceeded" };
    }
    return {
      ok: true,
      response: {
        imported: outcome.imported,
        skipped: outcome.skipped,
        mapping: outcome.mapping,
        records: outcome.records,
      },
    };
  }

  export(owner: number): ExportResponse {
    return {
      exportedAt: this.nowIso(),
      records: this.store.exportRecords(owner),
    };
  }

  deleteAll(owner: number, body: unknown): ServiceResult<object> {
    if (
      !isPlainObject(body) ||
      !hasOnlyKeys(body, ["confirm"]) ||
      body.confirm !== "delete everything"
    ) {
      return invalid();
    }
    this.store.deleteAll(owner);
    return { ok: true };
  }
}
