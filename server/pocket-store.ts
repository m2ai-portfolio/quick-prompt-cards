import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import type {
  ExportedPromptRecord,
  LocalRecord,
  PromptRecord,
  RecordSource,
} from "../shared/pocket-contract.js";

export const DB_FILE_NAME = "prompt-pocket.sqlite";

/**
 * Schema from contracts/shared-pocket-v1.md "Entities". The contract writes the
 * uniqueness rule inline as `UNIQUE(...) WHERE ...`; SQLite expresses that as a
 * partial unique index, which is what is created here.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  telegram_user_id   INTEGER PRIMARY KEY,
  created_at         TEXT,
  last_seen_at       TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash         TEXT PRIMARY KEY,
  telegram_user_id   INTEGER NOT NULL,
  bot_key            TEXT NOT NULL,
  created_at         TEXT,
  expires_at         TEXT
);
CREATE TABLE IF NOT EXISTS prompt_records (
  id                     TEXT PRIMARY KEY,
  owner_telegram_user_id INTEGER NOT NULL,
  source                 TEXT NOT NULL,
  canonical_card_id      TEXT,
  title                  TEXT NOT NULL,
  category               TEXT NOT NULL,
  prompt                 TEXT NOT NULL,
  hidden                 INTEGER NOT NULL DEFAULT 0,
  revision               INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT,
  updated_at             TEXT,
  deleted_at             TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_records_owner_canonical_unique
  ON prompt_records(owner_telegram_user_id, canonical_card_id)
  WHERE canonical_card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prompt_records_owner
  ON prompt_records(owner_telegram_user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at
  ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS create_idempotency (
  owner_telegram_user_id INTEGER NOT NULL,
  local_id               TEXT NOT NULL,
  record_id              TEXT NOT NULL,
  created_at             TEXT,
  PRIMARY KEY (owner_telegram_user_id, local_id)
);
`;

const RECORD_COLUMNS =
  "id, source, canonical_card_id, title, category, prompt, hidden, revision, created_at, updated_at, deleted_at";

type Row = Record<string, SQLOutputValue>;

export type StoredRecord = PromptRecord & { deletedAt: string | null };

export type NewRecordFields = {
  source: RecordSource;
  canonicalCardId: string | null;
  title: string;
  category: string;
  prompt: string;
  hidden: boolean;
};

export type RecordContent = {
  title: string;
  category: string;
  prompt: string;
  hidden: boolean;
};

export type RecordPatch = Partial<RecordContent>;

export type UpdateOutcome =
  | { outcome: "updated"; record: PromptRecord }
  | { outcome: "conflict"; current: PromptRecord }
  | { outcome: "not_found" };

export type ImportOutcome =
  | {
      outcome: "imported";
      imported: string[];
      skipped: string[];
      mapping: Record<string, string>;
      records: PromptRecord[];
    }
  | { outcome: "limit_exceeded" };

export type SessionRow = {
  userId: number;
  botKey: string;
  expiresAt: string;
};

export type UserRow = {
  telegramUserId: number;
  createdAt: string;
  lastSeenAt: string;
};

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-char ULID: 48-bit ms timestamp + 80 random bits, Crockford base32. */
export function generateRecordId(nowMs: number = Date.now()): string {
  let time = Math.max(0, Math.floor(nowMs));
  const timeChars: string[] = new Array<string>(10);
  for (let i = 9; i >= 0; i -= 1) {
    timeChars[i] = CROCKFORD[time % 32];
    time = Math.floor(time / 32);
  }
  let random = BigInt(`0x${randomBytes(10).toString("hex")}`);
  const randomChars: string[] = new Array<string>(16);
  for (let i = 15; i >= 0; i -= 1) {
    randomChars[i] = CROCKFORD[Number(random & 31n)];
    random >>= 5n;
  }
  return timeChars.join("") + randomChars.join("");
}

function contentHash(title: string, prompt: string): string {
  return createHash("sha256").update(`${title}\n${prompt}`).digest("hex");
}

class LimitExceeded extends Error {}

/** Thrown by `PocketStore.open` when the data directory is not usable. */
export class PocketStoreOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PocketStoreOpenError";
  }
}

/**
 * SQLite-backed storage for users, sessions, and prompt records. Every
 * prompt_records read or write carries `owner_telegram_user_id = ?` in the
 * SQL itself (contracts/shared-pocket-v1.md), with one deliberate exception:
 * `purgeSoftDeleted`, the retention job, which by definition spans owners and
 * touches only rows whose `deleted_at` is older than the retention window.
 */
export class PocketStore {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Opens (or creates) the database file inside an EXISTING directory. The
   * directory is never created here: in the container it is a bind mount, and
   * a missing or mistyped mount must fail startup rather than silently keep
   * every pocket in the container's writable layer (lost on image replace).
   */
  static open(dataDir: string): PocketStore {
    let isDirectory = false;
    try {
      isDirectory = statSync(dataDir).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new PocketStoreOpenError(
        `PROMPT_POCKET_DATA_DIR "${dataDir}" is not an existing directory; create it (and mount it) before starting.`,
      );
    }
    const db = new DatabaseSync(join(dataDir, DB_FILE_NAME), { timeout: 5000 });
    db.exec("PRAGMA journal_mode = WAL");
    return new PocketStore(db);
  }

  static inMemory(): PocketStore {
    return new PocketStore(new DatabaseSync(":memory:"));
  }

  close(): void {
    this.db.close();
  }

  /** Test-only introspection (schema assertions). Never used by handlers. */
  debugSql<T extends object>(sql: string): T[] {
    return this.db.prepare(sql).all() as unknown as T[];
  }

  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.transactionDepth -= 1;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  /* ---------- users ---------- */

  upsertUser(telegramUserId: number, nowIso: string): void {
    this.db
      .prepare(
        `INSERT INTO users (telegram_user_id, created_at, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .run(telegramUserId, nowIso, nowIso);
  }

  getUser(telegramUserId: number): UserRow | undefined {
    const row = this.db
      .prepare(
        "SELECT telegram_user_id, created_at, last_seen_at FROM users WHERE telegram_user_id = ?",
      )
      .get(telegramUserId) as Row | undefined;
    if (!row) return undefined;
    return {
      telegramUserId: Number(row.telegram_user_id),
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
    };
  }

  /* ---------- sessions ---------- */

  insertSession(session: {
    tokenHash: string;
    userId: number;
    botKey: string;
    createdAt: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, telegram_user_id, bot_key, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        session.tokenHash,
        session.userId,
        session.botKey,
        session.createdAt,
        session.expiresAt,
      );
  }

  getSession(tokenHash: string): SessionRow | undefined {
    const row = this.db
      .prepare(
        "SELECT telegram_user_id, bot_key, expires_at FROM sessions WHERE token_hash = ?",
      )
      .get(tokenHash) as Row | undefined;
    if (!row) return undefined;
    return {
      userId: Number(row.telegram_user_id),
      botKey: String(row.bot_key),
      expiresAt: String(row.expires_at),
    };
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteExpiredSessions(nowIso: string): number {
    const result = this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(nowIso);
    return Number(result.changes);
  }

  /* ---------- prompt records ---------- */

  listRecords(owner: number): PromptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM prompt_records
         WHERE owner_telegram_user_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all(owner) as Row[];
    return rows.map(toRecord);
  }

  getRecord(owner: number, id: string): StoredRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM prompt_records
         WHERE owner_telegram_user_id = ? AND id = ?`,
      )
      .get(owner, id) as Row | undefined;
    return row ? toStored(row) : undefined;
  }

  getActiveRecord(owner: number, id: string): PromptRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM prompt_records
         WHERE owner_telegram_user_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .get(owner, id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  findByCanonicalCardId(
    owner: number,
    canonicalCardId: string,
  ): StoredRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM prompt_records
         WHERE owner_telegram_user_id = ? AND canonical_card_id = ?`,
      )
      .get(owner, canonicalCardId) as Row | undefined;
    return row ? toStored(row) : undefined;
  }

  countActiveRecords(owner: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM prompt_records
         WHERE owner_telegram_user_id = ? AND deleted_at IS NULL`,
      )
      .get(owner) as Row;
    return Number(row.n);
  }

  insertRecord(
    owner: number,
    fields: NewRecordFields,
    nowIso: string,
  ): PromptRecord {
    const id = generateRecordId(Date.parse(nowIso) || Date.now());
    this.db
      .prepare(
        `INSERT INTO prompt_records
           (id, owner_telegram_user_id, source, canonical_card_id, title, category,
            prompt, hidden, revision, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
      )
      .run(
        id,
        owner,
        fields.source,
        fields.canonicalCardId,
        fields.title,
        fields.category,
        fields.prompt,
        fields.hidden ? 1 : 0,
        nowIso,
        nowIso,
      );
    const record = this.getActiveRecord(owner, id);
    if (!record) {
      throw new Error("insert did not persist");
    }
    return record;
  }

  /**
   * Idempotency for creates (contracts/shared-pocket-v1.md amendment:
   * CreateRecordRequest.localId). Maps an owner's client-generated localId
   * to the first record id it created. Returns undefined when unmapped.
   */
  findCreateIdempotency(owner: number, localId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT record_id FROM create_idempotency
         WHERE owner_telegram_user_id = ? AND local_id = ?`,
      )
      .get(owner, localId) as Row | undefined;
    return row ? String(row.record_id) : undefined;
  }

  rememberCreateIdempotency(
    owner: number,
    localId: string,
    recordId: string,
    nowIso: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO create_idempotency
           (owner_telegram_user_id, local_id, record_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(owner, localId, recordId, nowIso);
  }

  getIdempotentRecord(
    owner: number,
    recordId: string,
  ): PromptRecord | undefined {
    return this.getActiveRecord(owner, recordId);
  }

  /** Reactivates a soft-deleted row with new content; revision increments. */
  reviveRecord(
    owner: number,
    id: string,
    content: RecordContent,
    nowIso: string,
  ): PromptRecord | undefined {
    const result = this.db
      .prepare(
        `UPDATE prompt_records
         SET title = ?, category = ?, prompt = ?, hidden = ?,
             revision = revision + 1, updated_at = ?, deleted_at = NULL
         WHERE owner_telegram_user_id = ? AND id = ? AND deleted_at IS NOT NULL`,
      )
      .run(
        content.title,
        content.category,
        content.prompt,
        content.hidden ? 1 : 0,
        nowIso,
        owner,
        id,
      );
    if (Number(result.changes) === 0) return undefined;
    return this.getActiveRecord(owner, id);
  }

  updateRecord(
    owner: number,
    id: string,
    expectedRevision: number,
    patch: RecordPatch,
    nowIso: string,
  ): UpdateOutcome {
    return this.transaction(() => {
      const current = this.getActiveRecord(owner, id);
      if (!current) return { outcome: "not_found" };
      if (current.revision !== expectedRevision) {
        return { outcome: "conflict", current };
      }
      const result = this.db
        .prepare(
          `UPDATE prompt_records
           SET title = ?, category = ?, prompt = ?, hidden = ?,
               revision = revision + 1, updated_at = ?
           WHERE owner_telegram_user_id = ? AND id = ?
             AND revision = ? AND deleted_at IS NULL`,
        )
        .run(
          patch.title ?? current.title,
          patch.category ?? current.category,
          patch.prompt ?? current.prompt,
          (patch.hidden ?? current.hidden) ? 1 : 0,
          nowIso,
          owner,
          id,
          expectedRevision,
        );
      if (Number(result.changes) === 0) {
        const latest = this.getActiveRecord(owner, id);
        return latest
          ? { outcome: "conflict", current: latest }
          : { outcome: "not_found" };
      }
      const record = this.getActiveRecord(owner, id);
      if (!record) return { outcome: "not_found" };
      return { outcome: "updated", record };
    });
  }

  softDeleteRecord(owner: number, id: string, nowIso: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE prompt_records SET deleted_at = ?
         WHERE owner_telegram_user_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .run(nowIso, owner, id);
    return Number(result.changes) > 0;
  }

  restoreRecord(
    owner: number,
    id: string,
    nowIso: string,
    retentionDays: number,
  ): PromptRecord | undefined {
    const stored = this.getRecord(owner, id);
    if (!stored || stored.deletedAt === null) return undefined;
    const deletedAtMs = Date.parse(stored.deletedAt);
    const cutoffMs = Date.parse(nowIso) - retentionDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(deletedAtMs) || deletedAtMs < cutoffMs) {
      return undefined;
    }
    const result = this.db
      .prepare(
        `UPDATE prompt_records SET deleted_at = NULL, updated_at = ?
         WHERE owner_telegram_user_id = ? AND id = ? AND deleted_at IS NOT NULL`,
      )
      .run(nowIso, owner, id);
    if (Number(result.changes) === 0) return undefined;
    return this.getActiveRecord(owner, id);
  }

  /**
   * Retention job: hard-deletes rows soft-deleted more than `olderThanDays`
   * ago. Not owner scoped by design (see class comment); touches nothing else.
   */
  purgeSoftDeleted(olderThanDays: number, nowIso: string): number {
    const cutoff = new Date(
      Date.parse(nowIso) - olderThanDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = this.db
      .prepare(
        "DELETE FROM prompt_records WHERE deleted_at IS NOT NULL AND deleted_at < ?",
      )
      .run(cutoff);
    return Number(result.changes);
  }

  exportRecords(owner: number): ExportedPromptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM prompt_records
         WHERE owner_telegram_user_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(owner) as Row[];
    return rows.map(toStored);
  }

  /** Hard delete of everything the owner has: records, sessions, user row. */
  deleteAll(owner: number): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM prompt_records WHERE owner_telegram_user_id = ?")
        .run(owner);
      this.db
        .prepare("DELETE FROM sessions WHERE telegram_user_id = ?")
        .run(owner);
      this.db
        .prepare("DELETE FROM users WHERE telegram_user_id = ?")
        .run(owner);
    });
  }

  /**
   * One transaction. Dedupe key per contract: `(source, canonicalCardId ??
   * sha256(title + "\n" + prompt))` against the owner's existing records.
   * A canonical-override that matches a soft-deleted row is revived in place
   * (the unique index forbids a second row) and reported as imported.
   */
  importRecords(
    owner: number,
    records: LocalRecord[],
    nowIso: string,
    maxRecords: number,
  ): ImportOutcome {
    try {
      return this.transaction(() => {
        const imported: string[] = [];
        const skipped: string[] = [];
        const mapping: Record<string, string> = {};
        const orderedIds: string[] = [];
        const batchKeys = new Map<string, string>();

        const personalHashes = new Map<string, string>();
        for (const existing of this.listRecords(owner)) {
          if (existing.source === "personal") {
            personalHashes.set(
              contentHash(existing.title, existing.prompt),
              existing.id,
            );
          }
        }

        let activeCount = this.countActiveRecords(owner);

        const remember = (localId: string, id: string, key: string) => {
          mapping[localId] = id;
          batchKeys.set(key, id);
          if (!orderedIds.includes(id)) orderedIds.push(id);
        };
        const admitOne = () => {
          activeCount += 1;
          if (activeCount > maxRecords) throw new LimitExceeded();
        };

        for (const local of records) {
          const content: RecordContent = {
            title: local.title,
            category: local.category,
            prompt: local.prompt,
            hidden: local.hidden ?? false,
          };

          if (local.source === "canonical-override") {
            const cardId = local.canonicalCardId ?? "";
            const key = `canonical-override:${cardId}`;
            const inBatch = batchKeys.get(key);
            if (inBatch) {
              skipped.push(local.localId);
              remember(local.localId, inBatch, key);
              continue;
            }
            const existing = this.findByCanonicalCardId(owner, cardId);
            if (existing && existing.deletedAt === null) {
              skipped.push(local.localId);
              remember(local.localId, existing.id, key);
              continue;
            }
            admitOne();
            const record = existing
              ? this.reviveRecord(owner, existing.id, content, nowIso)
              : this.insertRecord(
                  owner,
                  {
                    source: "canonical-override",
                    canonicalCardId: cardId,
                    ...content,
                  },
                  nowIso,
                );
            if (!record) throw new Error("revive did not persist");
            imported.push(local.localId);
            remember(local.localId, record.id, key);
            continue;
          }

          const hash = contentHash(local.title, local.prompt);
          const key = `personal:${hash}`;
          const inBatch = batchKeys.get(key) ?? personalHashes.get(hash);
          if (inBatch) {
            skipped.push(local.localId);
            remember(local.localId, inBatch, key);
            continue;
          }
          admitOne();
          const record = this.insertRecord(
            owner,
            { source: "personal", canonicalCardId: null, ...content },
            nowIso,
          );
          imported.push(local.localId);
          remember(local.localId, record.id, key);
        }

        const resultRecords: PromptRecord[] = [];
        for (const id of orderedIds) {
          const record = this.getActiveRecord(owner, id);
          if (record) resultRecords.push(record);
        }
        return {
          outcome: "imported",
          imported,
          skipped,
          mapping,
          records: resultRecords,
        };
      });
    } catch (error) {
      if (error instanceof LimitExceeded) {
        return { outcome: "limit_exceeded" };
      }
      throw error;
    }
  }
}

function toRecord(row: Row): PromptRecord {
  return {
    id: String(row.id),
    source: String(row.source) as RecordSource,
    canonicalCardId:
      row.canonical_card_id === null ? null : String(row.canonical_card_id),
    title: String(row.title),
    category: String(row.category),
    prompt: String(row.prompt),
    hidden: Number(row.hidden) === 1,
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toStored(row: Row): StoredRecord {
  return {
    ...toRecord(row),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
  };
}
