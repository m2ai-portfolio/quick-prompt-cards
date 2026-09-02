import { describe, expect, it } from "vitest";
import { buildPrompt, filterPrompts, toggleFavorite } from "./prompt-utils";
import { prompts } from "./prompts";
import type { PromptCard } from "./types";

const cards: PromptCard[] = [
  {
    id: "email",
    kind: "prompt",
    title: "Write a clear email",
    description: "Turn notes into a polished message.",
    category: "Writing",
    tags: ["message", "work"],
    template: "Write an email about {{topic}}.",
    fields: [
      {
        key: "topic",
        label: "What is it about?",
        placeholder: "Project update",
      },
    ],
    action: {
      type: "prompt-delivery",
      requiresConfirmation: true,
      preferred: "telegram-webapp-query",
      fallback: "clipboard",
    },
  },
  {
    id: "research",
    kind: "prompt",
    title: "Research a decision",
    description: "Compare options before choosing.",
    category: "Research",
    tags: ["compare", "decision"],
    template: "Compare {{options}}.",
    fields: [
      {
        key: "options",
        label: "What are the options?",
        placeholder: "A and B",
      },
    ],
    action: {
      type: "prompt-delivery",
      requiresConfirmation: true,
      preferred: "telegram-webapp-query",
      fallback: "clipboard",
    },
  },
];

describe("prompt card schema", () => {
  it("marks every existing card as a confirmed prompt-delivery card", () => {
    expect(prompts).not.toHaveLength(0);
    expect(
      prompts.every(
        (card) =>
          card.kind === "prompt" &&
          card.action.type === "prompt-delivery" &&
          card.action.requiresConfirmation === true &&
          card.action.preferred === "telegram-webapp-query" &&
          card.action.fallback === "clipboard",
      ),
    ).toBe(true);
  });
});

describe("filterPrompts", () => {
  it("matches title, description, category, and tags without case sensitivity", () => {
    expect(filterPrompts(cards, "POLISHED", "All")).toEqual([cards[0]]);
    expect(filterPrompts(cards, "compare", "All")).toEqual([cards[1]]);
    expect(filterPrompts(cards, "", "Writing")).toEqual([cards[0]]);
  });
});

describe("buildPrompt", () => {
  it("replaces repeated placeholders and marks missing answers clearly", () => {
    const template =
      "Explain {{topic}}. Then give an example of {{topic}} for {{audience}}.";

    expect(buildPrompt(template, { topic: "budgeting", audience: "" })).toBe(
      "Explain budgeting. Then give an example of budgeting for [AUDIENCE NEEDED].",
    );
  });
});

describe("toggleFavorite", () => {
  it("adds a new favorite and removes an existing favorite", () => {
    expect(toggleFavorite(["email"], "research")).toEqual([
      "email",
      "research",
    ]);
    expect(toggleFavorite(["email", "research"], "email")).toEqual([
      "research",
    ]);
  });
});
