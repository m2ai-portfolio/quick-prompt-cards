import { promptCatalog } from "../shared/prompt-catalog";
import type { PromptCard } from "./types";

export const prompts: PromptCard[] = promptCatalog.map((card) => ({
  ...card,
  kind: "prompt",
  action: {
    type: "prompt-delivery",
    requiresConfirmation: false,
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
}));

export const categories = [
  "All",
  "Writing",
  "Decisions",
  "Learning",
  "Research",
  "Analysis",
  "Planning",
  "Ideas",
  "Business",
] as const;
