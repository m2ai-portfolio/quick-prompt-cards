export type PromptDraftInput = {
  goal: string;
  context: string;
  format: string;
};

export type PinnedPrompt = {
  id: string;
  title: string;
  prompt: string;
};

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

export function createPromptDraft(input: PromptDraftInput): PinnedPrompt {
  const goal = input.goal.trim();
  const context = input.context.trim();
  const format = input.format.trim();
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const sections = [
    `Task: ${sentence(goal)}`,
    context
      ? `Context: ${sentence(context)}`
      : "Ask me for any context you need before starting.",
    "Ask up to three follow-up questions only when the answers would materially change the result.",
    format
      ? `Output format: ${sentence(format)}`
      : "Return a clear, practical result I can use immediately.",
    "Preserve the facts I provide, separate assumptions from facts, and do not invent missing details.",
  ];

  return {
    id: `pinned-${slug || "prompt"}`,
    title: goal,
    prompt: sections.join(" "),
  };
}

export function parsePinnedPrompts(raw: string | null): PinnedPrompt[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PinnedPrompt =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as PinnedPrompt).id === "string" &&
        typeof (item as PinnedPrompt).title === "string" &&
        typeof (item as PinnedPrompt).prompt === "string",
    );
  } catch {
    return [];
  }
}
