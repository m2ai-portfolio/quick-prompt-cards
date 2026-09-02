import {
  promptCatalog,
  type CatalogPromptCard,
} from "../shared/prompt-catalog.js";

/**
 * Resolves cardId against the canonical shared catalog (owned by A2). The
 * server never trusts client-supplied prompt text, only the card ID.
 */
export function resolveCard(cardId: string): CatalogPromptCard | undefined {
  return promptCatalog.find((card) => card.id === cardId);
}
