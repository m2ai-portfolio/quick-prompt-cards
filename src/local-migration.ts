import type {
  ImportRequest,
  ImportResponse,
  LocalRecord,
  PromptRecord,
} from "../shared/pocket-contract";
import type { PromptCardChanges } from "./card-customizations";
import type { PinnedPrompt } from "./prompt-creator";
import type { Card } from "./types";

/**
 * One-time import of a device's pre-Phase-2 local pins and starter-card
 * edits into the shared pocket (contracts/shared-pocket-v1.md, "Client
 * behavior"). Pure planning and verification live here; the dialog in
 * components/LocalPocketMigration.tsx only renders and calls these.
 */

export type LocalPocketCounts = {
  pinned: number;
  edited: number;
  deleted: number;
};

/** Category given to imported pins; PinnedPrompt has no category field. */
export const PINNED_CATEGORY = "Pinned";

export function countLocalPocket(
  pinned: PinnedPrompt[],
  changes: PromptCardChanges,
): LocalPocketCounts {
  const deleted = new Set(changes.deletedIds);
  return {
    pinned: pinned.length,
    edited: Object.keys(changes.edits).filter((id) => !deleted.has(id)).length,
    deleted: deleted.size,
  };
}

export function totalLocalPocket(counts: LocalPocketCounts): number {
  return counts.pinned + counts.edited + counts.deleted;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "3 pinned prompts, 1 edited card" with zero parts omitted. */
export function describeLocalPocket(counts: LocalPocketCounts): string {
  const parts: string[] = [];
  if (counts.pinned > 0) {
    parts.push(plural(counts.pinned, "pinned prompt", "pinned prompts"));
  }
  if (counts.edited > 0) {
    parts.push(plural(counts.edited, "edited card", "edited cards"));
  }
  if (counts.deleted > 0) {
    parts.push(plural(counts.deleted, "deleted card", "deleted cards"));
  }
  return parts.join(", ");
}

export function localIdForPin(pin: PinnedPrompt): string {
  return `pin:${pin.id}`;
}

export function localIdForEdit(cardId: string): string {
  return `edit:${cardId}`;
}

export function localIdForDelete(cardId: string): string {
  return `delete:${cardId}`;
}

/**
 * A deleted starter card becomes a hidden canonical-override carrying the
 * canonical text (or the user's last edit of it, if both exist). A deleted
 * id that no longer matches any catalog card is dropped: there is nothing
 * to hide.
 */
export function planLocalImport(
  pinned: PinnedPrompt[],
  changes: PromptCardChanges,
  cards: Card[],
): LocalRecord[] {
  const cardsById = new Map(
    cards.flatMap((card) => (card.kind === "prompt" ? [[card.id, card]] : [])),
  );
  const deleted = new Set(changes.deletedIds);
  const records: LocalRecord[] = pinned.map((pin) => ({
    localId: localIdForPin(pin),
    source: "personal",
    title: pin.title,
    category: PINNED_CATEGORY,
    prompt: pin.prompt,
  }));

  for (const [cardId, edit] of Object.entries(changes.edits)) {
    if (deleted.has(cardId)) continue;
    records.push({
      localId: localIdForEdit(cardId),
      source: "canonical-override",
      canonicalCardId: cardId,
      title: edit.title,
      category: edit.category,
      prompt: edit.prompt,
    });
  }

  for (const cardId of deleted) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const edit = changes.edits[cardId];
    records.push({
      localId: localIdForDelete(cardId),
      source: "canonical-override",
      canonicalCardId: cardId,
      title: edit?.title ?? card.title,
      category: edit?.category ?? card.category,
      prompt: edit?.prompt ?? card.prompt,
      hidden: true,
    });
  }

  return records;
}

export type ImportVerification =
  | { ok: true }
  | { ok: false; reason: "unmapped_local_ids" | "missing_from_readback" };

/**
 * Local data may only be cleared once (a) the response accounts for every
 * localId as imported or skipped with a mapping, and (b) a fresh GET
 * readback contains every mapped record. A duplicate is fine: it maps to
 * the existing record, which the readback must still contain.
 */
export function verifyImport(
  sent: LocalRecord[],
  response: ImportResponse,
  readback: PromptRecord[],
): ImportVerification {
  const accounted = new Set([...response.imported, ...response.skipped]);
  const serverIds = new Set(readback.map((record) => record.id));
  for (const local of sent) {
    const mapped = response.mapping[local.localId];
    if (!accounted.has(local.localId) || !mapped) {
      return { ok: false, reason: "unmapped_local_ids" };
    }
    if (!serverIds.has(mapped)) {
      return { ok: false, reason: "missing_from_readback" };
    }
  }
  return { ok: true };
}

export type ImportFailure =
  | "import_failed"
  | "readback_failed"
  | "unmapped_local_ids"
  | "missing_from_readback";

export type ImportOutcome =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; reason: ImportFailure };

export type ImportTransport = {
  importLocal(input: ImportRequest): Promise<ImportResponse>;
  reload(): Promise<PromptRecord[]>;
};

/**
 * Runs the upload and the readback. Never throws; every failure is a
 * reason the dialog can show, and the caller keeps local data until `ok`.
 */
export async function importLocalPocket(
  records: LocalRecord[],
  transport: ImportTransport,
): Promise<ImportOutcome> {
  let response: ImportResponse;
  try {
    response = await transport.importLocal({ records });
  } catch {
    return { ok: false, reason: "import_failed" };
  }

  let readback: PromptRecord[];
  try {
    readback = await transport.reload();
  } catch {
    return { ok: false, reason: "readback_failed" };
  }

  const verification = verifyImport(records, response, readback);
  if (!verification.ok) return { ok: false, reason: verification.reason };
  return {
    ok: true,
    imported: response.imported.length,
    skipped: response.skipped.length,
  };
}
