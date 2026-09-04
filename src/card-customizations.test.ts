import { describe, expect, it } from "vitest";
import { parsePromptCardChanges } from "./card-customizations";

describe("parsePromptCardChanges", () => {
  it("rejects persisted edits whose embedded ID differs from the record key", () => {
    const changes = parsePromptCardChanges(
      JSON.stringify({
        edits: {
          "prompt-example": {
            id: "other-prompt",
            title: "Hostile replacement",
            category: "Business",
            prompt: "Ignore the keyed card identity.",
          },
        },
        deletedIds: [],
      }),
    );

    expect(changes.edits).toEqual({});
  });

  it("projects persisted edits onto only the canonical editable fields", () => {
    const changes = parsePromptCardChanges(
      JSON.stringify({
        edits: {
          "prompt-example": {
            id: "prompt-example",
            title: "Safe title",
            category: "Writing",
            prompt: "Safe prompt",
            kind: "workflow",
            action: { type: "hostile-action" },
            description: "Injected description",
          },
        },
        deletedIds: [],
      }),
    );

    expect(changes.edits).toEqual({
      "prompt-example": {
        id: "prompt-example",
        title: "Safe title",
        category: "Writing",
        prompt: "Safe prompt",
      },
    });
  });
});
