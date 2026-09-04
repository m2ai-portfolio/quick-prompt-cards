import { describe, expect, it } from "vitest";
import { createPromptDraft } from "./prompt-creator";

describe("createPromptDraft", () => {
  it("preserves user wording in complete labeled sentences", () => {
    const draft = createPromptDraft({
      goal: "Turn meeting notes into action items",
      context: "Preserve owners and deadlines",
      format: "A prioritized checklist",
    });

    expect(draft.prompt).toContain(
      "Task: Turn meeting notes into action items.",
    );
    expect(draft.prompt).toContain("Context: Preserve owners and deadlines.");
    expect(draft.prompt).toContain("Output format: A prioritized checklist.");
  });
});
