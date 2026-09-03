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

export const silverPlatterCard: WorkflowCard = {
  id: "silver-platter",
  kind: "workflow",
  title: "Silver Platter: map your first automation",
  description:
    "Answer a few questions about your work and walk away with a named automation draft.",
  category: "Business",
  tags: ["automation", "silver-platter"],
  workflow: {
    id: "silver-platter",
    schemaVersion: "1.0",
    entryStage: "1_speed",
  },
};

export const prompts: Card[] = [...promptCards, silverPlatterCard];

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
