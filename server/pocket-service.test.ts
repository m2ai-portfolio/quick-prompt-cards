// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PocketStore } from "./pocket-store";
import { PocketService } from "./pocket-service";
import { POCKET_LIMITS } from "../shared/pocket-contract";

const OWNER_A = 1001;
const OWNER_B = 2002;
const NOW_MS = 1_800_000_000_000;

let store: PocketStore;
let service: PocketService;
let now: number;

beforeEach(() => {
  store = PocketStore.inMemory();
  now = NOW_MS;
  service = new PocketService(store, { now: () => now });
});

afterEach(() => {
  store.close();
});

const validCreate = {
  source: "personal" as const,
  title: "Draft a memo",
  category: "Writing",
  prompt: "Write a memo about X.",
};

function created(owner = OWNER_A, body: unknown = validCreate) {
  const result = service.create(owner, body);
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result.record;
}

describe("PocketService.create", () => {
  it("creates a personal record with defaults and returns the wire shape", () => {
    const result = service.create(OWNER_A, validCreate);

    expect(result).toEqual({
      ok: true,
      record: {
        id: expect.any(String),
        source: "personal",
        canonicalCardId: null,
        title: "Draft a memo",
        category: "Writing",
        prompt: "Write a memo about X.",
        hidden: false,
        revision: 1,
        createdAt: new Date(NOW_MS).toISOString(),
        updatedAt: new Date(NOW_MS).toISOString(),
      },
    });
  });

  it("rejects unknown fields, bad types, and a missing title as invalid_request", () => {
    expect(service.create(OWNER_A, { ...validCreate, ownerId: 5 })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.create(OWNER_A, { ...validCreate, title: 7 })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.create(OWNER_A, { ...validCreate, title: "  " })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.create(OWNER_A, { ...validCreate, prompt: "" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      service.create(OWNER_A, { ...validCreate, source: "shared" }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(service.create(OWNER_A, { ...validCreate, hidden: "yes" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.create(OWNER_A, null)).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.create(OWNER_A, [validCreate])).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });

  it("requires canonicalCardId for canonical-override and forbids it for personal", () => {
    expect(
      service.create(OWNER_A, { ...validCreate, source: "canonical-override" }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(
      service.create(OWNER_A, {
        ...validCreate,
        canonicalCardId: "clear-email",
      }),
    ).toEqual({ ok: false, error: "invalid_request" });
  });

  it("enforces title, category, and prompt limits as limit_exceeded, writing nothing", () => {
    const tooLongTitle = "t".repeat(POCKET_LIMITS.maxTitleChars + 1);
    const tooLongCategory = "c".repeat(POCKET_LIMITS.maxCategoryChars + 1);
    const tooLongPrompt = "p".repeat(POCKET_LIMITS.maxPromptBytes + 1);
    const multibyteOverflow = "é".repeat(POCKET_LIMITS.maxPromptBytes / 2 + 1);

    expect(
      service.create(OWNER_A, { ...validCreate, title: tooLongTitle }),
    ).toEqual({ ok: false, error: "limit_exceeded" });
    expect(
      service.create(OWNER_A, { ...validCreate, category: tooLongCategory }),
    ).toEqual({ ok: false, error: "limit_exceeded" });
    expect(
      service.create(OWNER_A, { ...validCreate, prompt: tooLongPrompt }),
    ).toEqual({ ok: false, error: "limit_exceeded" });
    expect(
      service.create(OWNER_A, { ...validCreate, prompt: multibyteOverflow }),
    ).toEqual({ ok: false, error: "limit_exceeded" });
    expect(store.listRecords(OWNER_A)).toEqual([]);

    const maxTitle = "t".repeat(POCKET_LIMITS.maxTitleChars);
    const maxPrompt = "p".repeat(POCKET_LIMITS.maxPromptBytes);
    expect(
      service.create(OWNER_A, {
        ...validCreate,
        title: maxTitle,
        prompt: maxPrompt,
      }).ok,
    ).toBe(true);
  });

  it("enforces the per-user record count", () => {
    for (let i = 0; i < POCKET_LIMITS.maxRecordsPerUser; i += 1) {
      created(OWNER_A, { ...validCreate, title: `Prompt ${i}` });
    }
    expect(service.create(OWNER_A, validCreate)).toEqual({
      ok: false,
      error: "limit_exceeded",
    });
    // Another user is unaffected.
    expect(service.create(OWNER_B, validCreate).ok).toBe(true);
  });

  it("does not count soft-deleted records against the limit", () => {
    for (let i = 0; i < POCKET_LIMITS.maxRecordsPerUser; i += 1) {
      created(OWNER_A, { ...validCreate, title: `Prompt ${i}` });
    }
    const victim = store.listRecords(OWNER_A)[0];
    service.delete(OWNER_A, victim.id);
    expect(service.create(OWNER_A, validCreate).ok).toBe(true);
  });

  it("canonical-override create is idempotent per canonicalCardId", () => {
    const body = {
      source: "canonical-override" as const,
      canonicalCardId: "clear-email",
      title: "My email",
      category: "Writing",
      prompt: "Write my email.",
    };
    const first = service.create(OWNER_A, body);
    const second = service.create(OWNER_A, { ...body, title: "Changed" });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.record).toEqual(first.record);
    expect(store.listRecords(OWNER_A)).toHaveLength(1);
  });

  it("canonical-override create revives a soft-deleted override rather than failing", () => {
    const body = {
      source: "canonical-override" as const,
      canonicalCardId: "clear-email",
      title: "My email",
      category: "Writing",
      prompt: "Write my email.",
      hidden: true,
    };
    const first = created(OWNER_A, body);
    service.delete(OWNER_A, first.id);

    const again = service.create(OWNER_A, { ...body, title: "Second edit" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.record.id).toBe(first.id);
    expect(again.record.title).toBe("Second edit");
    expect(again.record.revision).toBe(2);
    expect(store.listRecords(OWNER_A)).toHaveLength(1);
  });
});

describe("PocketService.update", () => {
  it("applies a CAS update and bumps revision", () => {
    const record = created();
    now += 1000;

    const result = service.update(OWNER_A, record.id, {
      revision: 1,
      prompt: "Rewritten.",
      hidden: true,
    });

    expect(result).toEqual({
      ok: true,
      record: {
        ...record,
        prompt: "Rewritten.",
        hidden: true,
        revision: 2,
        updatedAt: new Date(now).toISOString(),
      },
    });
  });

  it("returns revision_conflict with the current record on a stale revision", () => {
    const record = created();
    service.update(OWNER_A, record.id, { revision: 1, title: "v2" });

    const stale = service.update(OWNER_A, record.id, {
      revision: 1,
      title: "lost",
    });

    expect(stale).toEqual({
      ok: false,
      error: "revision_conflict",
      current: expect.objectContaining({ revision: 2, title: "v2" }),
    });
  });

  it("returns not_found for another owner's record, an unknown id, or a soft-deleted record", () => {
    const record = created();
    expect(
      service.update(OWNER_B, record.id, { revision: 1, title: "x" }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      service.update(OWNER_A, "nope", { revision: 1, title: "x" }),
    ).toEqual({ ok: false, error: "not_found" });
    service.delete(OWNER_A, record.id);
    expect(
      service.update(OWNER_A, record.id, { revision: 1, title: "x" }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("validates the patch: unknown fields, missing revision, empty patch, limits", () => {
    const record = created();
    expect(
      service.update(OWNER_A, record.id, { revision: 1, source: "personal" }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(service.update(OWNER_A, record.id, { title: "x" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      service.update(OWNER_A, record.id, { revision: "1", title: "x" }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(service.update(OWNER_A, record.id, { revision: 1 })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      service.update(OWNER_A, record.id, {
        revision: 1,
        prompt: "p".repeat(POCKET_LIMITS.maxPromptBytes + 1),
      }),
    ).toEqual({ ok: false, error: "limit_exceeded" });
    expect(store.getActiveRecord(OWNER_A, record.id)?.revision).toBe(1);
  });
});

describe("PocketService delete, restore, list, export, deleteAll", () => {
  it("delete soft-deletes and is owner scoped", () => {
    const record = created();
    expect(service.delete(OWNER_B, record.id)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(service.delete(OWNER_A, record.id)).toEqual({ ok: true });
    expect(service.delete(OWNER_A, record.id)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(service.list(OWNER_A).records).toEqual([]);
  });

  it("restore is owner scoped and bounded by the retention window", () => {
    const record = created();
    service.delete(OWNER_A, record.id);

    expect(service.restore(OWNER_B, record.id)).toEqual({
      ok: false,
      error: "not_found",
    });
    const restored = service.restore(OWNER_A, record.id);
    expect(restored.ok).toBe(true);
    expect(service.list(OWNER_A).records).toHaveLength(1);

    service.delete(OWNER_A, record.id);
    now += (POCKET_LIMITS.softDeleteRetentionDays + 1) * 24 * 60 * 60 * 1000;
    expect(service.restore(OWNER_A, record.id)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("list returns active records plus the limits object", () => {
    created();
    const list = service.list(OWNER_A);
    expect(list.records).toHaveLength(1);
    expect(list.limits).toEqual(POCKET_LIMITS);
    expect(service.list(OWNER_B).records).toEqual([]);
  });

  it("export includes soft-deleted rows with deletedAt and is owner scoped", () => {
    const a = created();
    created(OWNER_B);
    service.delete(OWNER_A, a.id);

    const exported = service.export(OWNER_A);
    expect(exported.exportedAt).toBe(new Date(now).toISOString());
    expect(exported.records).toEqual([
      expect.objectContaining({ id: a.id, deletedAt: expect.any(String) }),
    ]);
  });

  it("deleteAll requires the exact confirm phrase and only removes the owner's data", () => {
    const a = created();
    const b = created(OWNER_B);

    expect(service.deleteAll(OWNER_A, { confirm: "yes" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      service.deleteAll(OWNER_A, { confirm: "delete everything", extra: 1 }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(store.getActiveRecord(OWNER_A, a.id)).toBeDefined();

    expect(
      service.deleteAll(OWNER_A, { confirm: "delete everything" }),
    ).toEqual({ ok: true });
    expect(service.export(OWNER_A).records).toEqual([]);
    expect(store.getActiveRecord(OWNER_B, b.id)).toBeDefined();
  });
});

describe("PocketService.import", () => {
  const payload = {
    records: [
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
    ],
  };

  it("imports then is idempotent on replay", () => {
    const first = service.import(OWNER_A, payload);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.response.imported).toEqual([
      "pinned-memo",
      "edit-clear-email",
    ]);
    expect(first.response.skipped).toEqual([]);
    expect(first.response.records).toHaveLength(2);
    expect(Object.keys(first.response.mapping)).toHaveLength(2);

    const second = service.import(OWNER_A, payload);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.response.imported).toEqual([]);
    expect(second.response.skipped).toEqual([
      "pinned-memo",
      "edit-clear-email",
    ]);
    expect(second.response.mapping).toEqual(first.response.mapping);
  });

  it("rejects malformed payloads, unknown fields, and duplicate localIds as invalid_request", () => {
    expect(service.import(OWNER_A, {})).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.import(OWNER_A, { records: "nope" })).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(
      service.import(OWNER_A, { records: payload.records, extra: true }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(
      service.import(OWNER_A, {
        records: [{ ...payload.records[0], ownerTelegramUserId: 1 }],
      }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(
      service.import(OWNER_A, {
        records: [payload.records[0], payload.records[0]],
      }),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(store.listRecords(OWNER_A)).toEqual([]);
  });

  it("rejects an oversized prompt anywhere in the batch with limit_exceeded and writes nothing", () => {
    const result = service.import(OWNER_A, {
      records: [
        payload.records[0],
        {
          ...payload.records[1],
          prompt: "p".repeat(POCKET_LIMITS.maxPromptBytes + 1),
        },
      ],
    });
    expect(result).toEqual({ ok: false, error: "limit_exceeded" });
    expect(store.listRecords(OWNER_A)).toEqual([]);
  });

  it("rejects a batch that would exceed the count limit and writes nothing", () => {
    for (let i = 0; i < POCKET_LIMITS.maxRecordsPerUser - 1; i += 1) {
      created(OWNER_A, { ...validCreate, title: `Prompt ${i}` });
    }
    expect(service.import(OWNER_A, payload)).toEqual({
      ok: false,
      error: "limit_exceeded",
    });
    expect(store.listRecords(OWNER_A)).toHaveLength(
      POCKET_LIMITS.maxRecordsPerUser - 1,
    );
  });

  it("an empty batch is a valid no-op", () => {
    expect(service.import(OWNER_A, { records: [] })).toEqual({
      ok: true,
      response: { imported: [], skipped: [], mapping: {}, records: [] },
    });
  });
});
