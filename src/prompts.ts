import { promptCatalog } from "../shared/prompt-catalog";
import type { Card, PromptCard, WorkflowCard } from "./types";

const promptCards: PromptCard[] = promptCatalog.map((card) => ({
  ...card,
  kind: "prompt",
  action: {
    type: "prompt-delivery",
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
}));

export const silverPocketCard: WorkflowCard = {
  id: "silver-pocket",
  kind: "workflow",
  title: "Silver Pocket: map your first automation",
  description:
    "Answer a few focused questions and leave with a clear, provider-neutral automation draft.",
  category: "Business",
  tags: ["automation", "silver-pocket", "workflow"],
  workflow: {
    id: "silver-pocket",
    schemaVersion: "2.0",
    entryStage: "task",
  },
};

export const prompts: Card[] = [...promptCards, silverPocketCard];

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
