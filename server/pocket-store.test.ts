// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DB_FILE_NAME,
  PocketStore,
  PocketStoreOpenError,
  generateRecordId,
} from "./pocket-store";
import type { LocalRecord } from "../shared/pocket-contract";

const OWNER_A = 1001;
const OWNER_B = 2002;
const T0 = "2026-09-05T12:00:00.000Z";
const T1 = "2026-09-05T12:05:00.000Z";

let store: PocketStore;

beforeEach(() => {
  store = PocketStore.inMemory();
});

afterEach(() => {
  store.close();
});

function personal(
  overrides: Partial<Parameters<PocketStore["insertRecord"]>[1]> = {},
) {
  return {
    source: "personal" as const,
    canonicalCardId: null,
    title: "Draft a memo",
    category: "Writing",
    prompt: "Write a memo about X.",
    hidden: false,
    ...overrides,
  };
}

describe("PocketStore.open", () => {
  it("throws PocketStoreOpenError on a missing directory and creates nothing", () => {
    const missing = join(
      tmpdir(),
      `prompt-pocket-does-not-exist-${Date.now()}`,
    );
    expect(existsSync(missing)).toBe(false);
    expect(() => PocketStore.open(missing)).toThrow(PocketStoreOpenError);
    // Fail-closed: the directory and the database file must not be created
    // as a side effect (a masked missing volume mount would silently keep
    // every pocket in the container's writable layer).
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(missing, DB_FILE_NAME))).toBe(false);
  });

  it("opens an existing directory and creates the database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompt-pocket-open-"));
    try {
      const opened = PocketStore.open(dir);
      try {
        expect(existsSync(join(dir, DB_FILE_NAME))).toBe(true);
      } finally {
        opened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("PocketStore schema", () => {
  it("creates the three tables and the partial unique index", () => {
    const names = store
      .debugSql<{ name: string; type: string }>(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name",
      )
      .map((row) => `${row.type}:${row.name}`);

    expect(names).toContain("table:users");
    expect(names).toContain("table:sessions");
    expect(names).toContain("table:prompt_records");
    expect(names).toContain("index:prompt_records_owner_canonical_unique");

    const indexSql = store.debugSql<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'prompt_records_owner_canonical_unique'",
    )[0].sql;
    expect(indexSql).toMatch(/UNIQUE/);
    expect(indexSql).toMatch(/WHERE canonical_card_id IS NOT NULL/);
  });

  it("opens a WAL-mode file at PROMPT_POCKET_DATA_DIR/prompt-pocket.sqlite", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-store-"));
    try {
      const fileStore = PocketStore.open(dir);
      const mode = fileStore.debugSql<{ journal_mode: string }>(
        "PRAGMA journal_mode",
      )[0].journal_mode;
      fileStore.close();
      expect(mode).toBe("wal");
      expect(existsSync(join(dir, "prompt-pocket.sqlite"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent to open twice (schema is CREATE IF NOT EXISTS)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-store-"));
    try {
      PocketStore.open(dir).close();
      const again = PocketStore.open(dir);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generateRecordId", () => {
  it("produces 26-char Crockford base32 ids that are unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateRecordId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });
});

describe("PocketStore records", () => {
  it("inserts and lists records for the owner only, never exposing the owner id", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);

    expect(record).toEqual({
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      source: "personal",
      canonicalCardId: null,
      title: "Draft a memo",
      category: "Writing",
      prompt: "Write a memo about X.",
      hidden: false,
      revision: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(Object.keys(record)).not.toContain("ownerTelegramUserId");
    expect(store.listRecords(OWNER_A)).toEqual([record]);
    expect(store.listRecords(OWNER_B)).toEqual([]);
  });

  it("scopes getActiveRecord by owner: another user's id resolves to nothing", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);

    expect(store.getActiveRecord(OWNER_A, record.id)).toEqual(record);
    expect(store.getActiveRecord(OWNER_B, record.id)).toBeUndefined();
  });

  it("enforces the partial unique index on (owner, canonical_card_id)", () => {
    const fields = personal({
      source: "canonical-override",
      canonicalCardId: "clear-email",
    });
    store.insertRecord(OWNER_A, fields, T0);

    expect(() => store.insertRecord(OWNER_A, fields, T0)).toThrow();
    // Another owner may override the same card.
    expect(() => store.insertRecord(OWNER_B, fields, T0)).not.toThrow();
    // Personal records (NULL canonical id) are not constrained.
    store.insertRecord(OWNER_A, personal(), T0);
    store.insertRecord(OWNER_A, personal(), T0);
    expect(store.listRecords(OWNER_A)).toHaveLength(3);
  });

  it("findByCanonicalCardId is owner scoped", () => {
    const fields = personal({
      source: "canonical-override",
      canonicalCardId: "clear-email",
    });
    const mine = store.insertRecord(OWNER_A, fields, T0);

    expect(store.findByCanonicalCardId(OWNER_A, "clear-email")?.id).toBe(
      mine.id,
    );
    expect(store.findByCanonicalCardId(OWNER_B, "clear-email")).toBeUndefined();
  });

  it("updateRecord is compare-and-swap on revision and increments it", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);

    const updated = store.updateRecord(
      OWNER_A,
      record.id,
      1,
      { title: "Draft a better memo" },
      T1,
    );
    expect(updated).toEqual({
      outcome: "updated",
      record: {
        ...record,
        title: "Draft a better memo",
        revision: 2,
        updatedAt: T1,
      },
    });

    const stale = store.updateRecord(
      OWNER_A,
      record.id,
      1,
      { title: "Lost update" },
      T1,
    );
    expect(stale).toEqual({
      outcome: "conflict",
      current: expect.objectContaining({
        revision: 2,
        title: "Draft a better memo",
      }),
    });
  });

  it("updateRecord for another owner's record is not_found and writes nothing", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);

    const result = store.updateRecord(
      OWNER_B,
      record.id,
      1,
      { title: "Hijacked" },
      T1,
    );
    expect(result).toEqual({ outcome: "not_found" });
    expect(store.getActiveRecord(OWNER_A, record.id)?.title).toBe(
      "Draft a memo",
    );
  });

  it("soft delete hides the record from list and getActiveRecord, keeps it in export with deletedAt", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);

    expect(store.softDeleteRecord(OWNER_A, record.id, T1)).toBe(true);
    expect(store.listRecords(OWNER_A)).toEqual([]);
    expect(store.getActiveRecord(OWNER_A, record.id)).toBeUndefined();
    expect(store.exportRecords(OWNER_A)).toEqual([
      { ...record, deletedAt: T1 },
    ]);
    // Second delete is a no-op.
    expect(store.softDeleteRecord(OWNER_A, record.id, T1)).toBe(false);
  });

  it("soft delete is owner scoped", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);
    expect(store.softDeleteRecord(OWNER_B, record.id, T1)).toBe(false);
    expect(store.listRecords(OWNER_A)).toHaveLength(1);
  });

  it("restore brings a soft-deleted record back within the retention window only", () => {
    const record = store.insertRecord(OWNER_A, personal(), T0);
    store.softDeleteRecord(OWNER_A, record.id, T1);

    expect(store.restoreRecord(OWNER_B, record.id, T1, 30)).toBeUndefined();
    const restored = store.restoreRecord(OWNER_A, record.id, T1, 30);
    expect(restored).toEqual({ ...record, updatedAt: T1 });
    expect(store.listRecords(OWNER_A)).toEqual([restored]);
    // Not deleted anymore: restore again is a no-op.
    expect(store.restoreRecord(OWNER_A, record.id, T1, 30)).toBeUndefined();

    store.softDeleteRecord(OWNER_A, record.id, T1);
    const thirtyOneDaysLater = new Date(
      Date.parse(T1) + 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(
      store.restoreRecord(OWNER_A, record.id, thirtyOneDaysLater, 30),
    ).toBeUndefined();
  });

  it("purgeSoftDeleted removes only rows deleted more than N days ago", () => {
    const keepActive = store.insertRecord(OWNER_A, personal(), T0);
    const recentlyDeleted = store.insertRecord(OWNER_A, personal(), T0);
    const oldDeleted = store.insertRecord(OWNER_B, personal(), T0);
    const day = 24 * 60 * 60 * 1000;
    const now = Date.parse(T1) + 40 * day;
    store.softDeleteRecord(
      OWNER_A,
      recentlyDeleted.id,
      new Date(now - 5 * day).toISOString(),
    );
    store.softDeleteRecord(
      OWNER_B,
      oldDeleted.id,
      new Date(now - 31 * day).toISOString(),
    );

    expect(store.purgeSoftDeleted(30, new Date(now).toISOString())).toBe(1);
    expect(store.getRecord(OWNER_B, oldDeleted.id)).toBeUndefined();
    expect(store.getRecord(OWNER_A, recentlyDeleted.id)).toBeDefined();
    expect(store.getActiveRecord(OWNER_A, keepActive.id)).toBeDefined();
  });

  it("countActiveRecords excludes soft-deleted rows and other owners", () => {
    const a1 = store.insertRecord(OWNER_A, personal(), T0);
    store.insertRecord(OWNER_A, personal(), T0);
    store.insertRecord(OWNER_B, personal(), T0);
    store.softDeleteRecord(OWNER_A, a1.id, T1);

    expect(store.countActiveRecords(OWNER_A)).toBe(1);
    expect(store.countActiveRecords(OWNER_B)).toBe(1);
  });

  it("deleteAll hard deletes the owner's records, sessions, and user row, nothing else", () => {
    store.upsertUser(OWNER_A, T0);
    store.upsertUser(OWNER_B, T0);
    store.insertSession({
      tokenHash: "hash-a",
      userId: OWNER_A,
      botKey: "hermes1",
      createdAt: T0,
      expiresAt: T1,
    });
    store.insertSession({
      tokenHash: "hash-b",
      userId: OWNER_B,
      botKey: "hermes1",
      createdAt: T0,
      expiresAt: T1,
    });
    const a = store.insertRecord(OWNER_A, personal(), T0);
    store.softDeleteRecord(OWNER_A, a.id, T1);
    const b = store.insertRecord(OWNER_B, personal(), T0);

    store.deleteAll(OWNER_A);

    expect(store.exportRecords(OWNER_A)).toEqual([]);
    expect(store.getSession("hash-a")).toBeUndefined();
    expect(store.getUser(OWNER_A)).toBeUndefined();
    expect(store.getSession("hash-b")).toBeDefined();
    expect(store.getUser(OWNER_B)).toBeDefined();
    expect(store.getActiveRecord(OWNER_B, b.id)).toBeDefined();
  });

  it("reviveRecord reactivates a soft-deleted row with new content and a bumped revision", () => {
    const record = store.insertRecord(
      OWNER_A,
      personal({
        source: "canonical-override",
        canonicalCardId: "clear-email",
      }),
      T0,
    );
    store.softDeleteRecord(OWNER_A, record.id, T1);

    const revived = store.reviveRecord(
      OWNER_A,
      record.id,
      { title: "New title", category: "", prompt: "New prompt", hidden: true },
      T1,
    );

    expect(revived).toEqual({
      ...record,
      title: "New title",
      category: "",
      prompt: "New prompt",
      hidden: true,
      revision: 2,
      updatedAt: T1,
    });
    expect(
      store.reviveRecord(
        OWNER_B,
        record.id,
        { title: "x", category: "", prompt: "y", hidden: false },
        T1,
      ),
    ).toBeUndefined();
  });
});

describe("PocketStore sessions and users", () => {
  it("upsertUser inserts once and updates last_seen_at on repeat", () => {
    store.upsertUser(OWNER_A, T0);
    store.upsertUser(OWNER_A, T1);
    expect(store.getUser(OWNER_A)).toEqual({
      telegramUserId: OWNER_A,
      createdAt: T0,
      lastSeenAt: T1,
    });
  });

  it("deleteExpiredSessions removes only sessions past expires_at", () => {
    store.insertSession({
      tokenHash: "old",
      userId: OWNER_A,
      botKey: "hermes1",
      createdAt: T0,
      expiresAt: T0,
    });
    store.insertSession({
      tokenHash: "fresh",
      userId: OWNER_A,
      botKey: "hermes1",
      createdAt: T0,
      expiresAt: "2026-09-07T00:00:00.000Z",
    });

    expect(store.deleteExpiredSessions(T1)).toBe(1);
    expect(store.getSession("old")).toBeUndefined();
    expect(store.getSession("fresh")).toBeDefined();
  });
});

describe("PocketStore import", () => {
  const local: LocalRecord[] = [
    {
      localId: "pinned-memo",
      source: "personal",
      title: "Draft a memo",
      category: "",
      prompt: "Write a memo about X.",
    },
    {
      localId: "edit-clear-email",
      source: "canonical-override",
      canonicalCardId: "clear-email",
      title: "My email prompt",
      category: "Writing",
      prompt: "Write my email.",
      hidden: false,
    },
  ];

  it("imports new records, then replaying the same payload creates nothing", () => {
    const first = store.importRecords(OWNER_A, local, T0, 200);
    expect(first.outcome).toBe("imported");
    if (first.outcome !== "imported") return;
    expect(first.imported).toEqual(["pinned-memo", "edit-clear-email"]);
    expect(first.skipped).toEqual([]);
    expect(Object.keys(first.mapping).sort()).toEqual(
      ["edit-clear-email", "pinned-memo"].sort(),
    );
    expect(first.records).toHaveLength(2);

    const second = store.importRecords(OWNER_A, local, T1, 200);
    expect(second.outcome).toBe("imported");
    if (second.outcome !== "imported") return;
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual(["pinned-memo", "edit-clear-email"]);
    expect(second.mapping).toEqual(first.mapping);
    expect(store.listRecords(OWNER_A)).toHaveLength(2);
  });

  it("dedupes personal records by sha256(title + newline + prompt), not by localId", () => {
    store.importRecords(OWNER_A, [local[0]], T0, 200);
    const renamedId = { ...local[0], localId: "some-other-local-id" };
    const result = store.importRecords(OWNER_A, [renamedId], T1, 200);

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.skipped).toEqual(["some-other-local-id"]);
    expect(store.listRecords(OWNER_A)).toHaveLength(1);
  });

  it("dedupes within a single batch too", () => {
    const result = store.importRecords(
      OWNER_A,
      [local[0], { ...local[0], localId: "dup-in-batch" }],
      T0,
      200,
    );
    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.imported).toEqual(["pinned-memo"]);
    expect(result.skipped).toEqual(["dup-in-batch"]);
    expect(result.mapping["dup-in-batch"]).toBe(result.mapping["pinned-memo"]);
  });

  it("does not dedupe across owners", () => {
    store.importRecords(OWNER_A, local, T0, 200);
    const result = store.importRecords(OWNER_B, local, T0, 200);
    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.imported).toHaveLength(2);
  });

  it("refuses the whole batch with limit_exceeded when the count limit would be passed", () => {
    store.insertRecord(OWNER_A, personal({ title: "existing" }), T0);
    const result = store.importRecords(OWNER_A, local, T0, 2);
    expect(result).toEqual({ outcome: "limit_exceeded" });
    expect(store.listRecords(OWNER_A)).toHaveLength(1);
  });

  it("is one transaction: a failure mid-batch leaves nothing partial", () => {
    const poison = [
      local[0],
      { ...local[1], title: { not: "a string" } as unknown as string },
    ];

    expect(() => store.importRecords(OWNER_A, poison, T0, 200)).toThrow();
    expect(store.listRecords(OWNER_A)).toEqual([]);
    expect(store.exportRecords(OWNER_A)).toEqual([]);
  });

  it("revives a soft-deleted canonical-override match instead of violating the unique index", () => {
    const first = store.importRecords(OWNER_A, [local[1]], T0, 200);
    if (first.outcome !== "imported") throw new Error("setup");
    const id = first.mapping["edit-clear-email"];
    store.softDeleteRecord(OWNER_A, id, T1);

    const again = store.importRecords(OWNER_A, [local[1]], T1, 200);
    expect(again.outcome).toBe("imported");
    if (again.outcome !== "imported") return;
    expect(again.imported).toEqual(["edit-clear-email"]);
    expect(again.mapping["edit-clear-email"]).toBe(id);
    expect(store.getActiveRecord(OWNER_A, id)?.revision).toBe(2);
  });

  it("transaction helper rolls back on throw", () => {
    expect(() =>
      store.transaction(() => {
        store.insertRecord(OWNER_A, personal(), T0);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.listRecords(OWNER_A)).toEqual([]);
  });
});
