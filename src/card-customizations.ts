import type { PromptCard } from "./types";

export type PromptCardEdit = Pick<
  PromptCard,
  "id" | "title" | "category" | "prompt"
>;

export type PromptCardChanges = {
  edits: Record<string, PromptCardEdit>;
  deletedIds: string[];
};

export const EMPTY_PROMPT_CARD_CHANGES: PromptCardChanges = {
  edits: {},
  deletedIds: [],
};

export function parsePromptCardChanges(raw: string | null): PromptCardChanges {
  if (!raw) return EMPTY_PROMPT_CARD_CHANGES;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_PROMPT_CARD_CHANGES;

    const candidate = value as Partial<PromptCardChanges>;
    const edits: Record<string, PromptCardEdit> = {};
    if (candidate.edits && typeof candidate.edits === "object") {
      Object.entries(candidate.edits).forEach(([id, edit]) => {
        if (
          edit &&
          typeof edit === "object" &&
          edit.id === id &&
          typeof edit.title === "string" &&
          typeof edit.category === "string" &&
          typeof edit.prompt === "string"
        ) {
          edits[id] = {
            id,
            title: edit.title,
            category: edit.category,
            prompt: edit.prompt,
          };
        }
      });
    }

    const deletedIds = Array.isArray(candidate.deletedIds)
      ? candidate.deletedIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];

    return { edits, deletedIds };
  } catch {
    return EMPTY_PROMPT_CARD_CHANGES;
  }
}

export function applyPromptCardChanges(
  cards: PromptCard[],
  changes: PromptCardChanges,
): PromptCard[] {
  const deleted = new Set(changes.deletedIds);
  return cards
    .filter((card) => !deleted.has(card.id))
    .map((card) => ({ ...card, ...changes.edits[card.id] }));
}
