import { describe, expect, it } from "vitest";
import { buildPrompt, filterPrompts, toggleFavorite } from "./prompt-utils";
import type { PromptCard } from "./types";

const cards: PromptCard[] = [
  {
    id: "email",
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
  },
  {
    id: "research",
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
  },
];

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
