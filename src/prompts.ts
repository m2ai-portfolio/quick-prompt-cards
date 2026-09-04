import { promptCatalog } from "../shared/prompt-catalog";
import type { Card, CreatorCard, PromptCard, WorkflowCard } from "./types";

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

export const createPromptCard: CreatorCard = {
  id: "create-prompt",
  kind: "creator",
  title: "Create a prompt",
  description:
    "Describe what you need, shape a reusable prompt, and pin it for later.",
  category: "Ideas",
  tags: ["create", "prompt", "custom", "pin"],
};

export const prompts: Card[] = [
  ...promptCards,
  createPromptCard,
  silverPocketCard,
];

export const categories = ["All", "Writing", "Ideas", "Business"] as const;
