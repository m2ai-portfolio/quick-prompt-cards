import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWizardState,
  createAutomationStorage,
  createWizardState,
  goBack,
  goNext,
  loadWizardState,
  saveWizardState,
  storageKeyFor,
  updateAnswer,
} from "./wizard-state";
import type { WorkflowDefinition } from "./types";

const definition: WorkflowDefinition = {
  id: "example",
  schemaVersion: "1.0",
  title: "Example workflow",
  steps: [
    {
      id: "step-one",
      title: "Step one",
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
    },
    {
      id: "step-two",
      title: "Step two",
      fields: [{ key: "detail", label: "Detail", type: "text" }],
    },
  ],
};

function validStoredState(overrides: Record<string, unknown> = {}) {
  return {
    contract: "automation-state/v1",
    workflowId: definition.id,
    schemaVersion: definition.schemaVersion,
    currentStageId: "step-two",
    status: "draft",
    answers: { name: "Acme" },
    completedStageIds: ["step-one"],
    updatedAt: "2026-09-03T04:00:00.000Z",
    ...overrides,
  };
}

describe("wizard-state navigation", () => {
  it("starts at the first step", () => {
    const state = createWizardState(definition);
    expect(state.stepIndex).toBe(0);
  });

  it("advances to the next step when the current step is valid", () => {
    const state = createWizardState(definition);
    const withAnswer = {
      ...state,
      answers: { name: "Acme" },
    };
    const next = goNext(withAnswer, definition);
    expect(next.stepIndex).toBe(1);
  });

  it("records the completed step id when advancing", () => {
    const state = {
      ...createWizardState(definition),
      answers: { name: "Acme" },
    };
    const next = goNext(state, definition);
    expect(next.completedStageIds).toEqual(["step-one"]);
  });

  it("does not advance past the last step", () => {
    const state = { ...createWizardState(definition), stepIndex: 1 };
    const next = goNext(state, definition);
    expect(next.stepIndex).toBe(1);
  });

  it("moves back to the previous step", () => {
    const state = { ...createWizardState(definition), stepIndex: 1 };
    const back = goBack(state);
    expect(back.stepIndex).toBe(0);
  });

  it("does not move back before the first step", () => {
    const state = createWizardState(definition);
    const back = goBack(state);
    expect(back.stepIndex).toBe(0);
  });
});

describe("wizard-state validation", () => {
  it("blocks advancing when a required field is empty", () => {
    const state = createWizardState(definition);
    const next = goNext(state, definition);
    expect(next.stepIndex).toBe(0);
    expect(next.errors.name).toMatch(/required/i);
  });

  it("blocks advancing when a required field is only whitespace", () => {
    const state = {
      ...createWizardState(definition),
      answers: { name: "   " },
    };
    const next = goNext(state, definition);
    expect(next.stepIndex).toBe(0);
    expect(next.errors.name).toBeDefined();
  });

  it("clears errors once the required field is filled", () => {
    const blocked = goNext(createWizardState(definition), definition);
    const filled = updateAnswer(blocked, "name", "Acme");
    const next = goNext(filled, definition);
    expect(next.stepIndex).toBe(1);
    expect(next.errors).toEqual({});
  });
});

describe("wizard-state persistence: automation-state/v1 contract", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the namespaced automation-state/v1 storage key", () => {
    expect(storageKeyFor("example")).toBe(
      "prompt-pocket:automation-state:v1:example",
    );
  });

  it("reports fresh when nothing is stored", () => {
    const storage = createAutomationStorage();
    const result = loadWizardState(definition, storage);
    expect(result.outcome).toBe("fresh");
    expect(result.state.stepIndex).toBe(0);
  });

  it("writes the frozen contract shape and resumes a valid contract-shaped record", () => {
    const storage = createAutomationStorage();
    const state = updateAnswer(
      { ...createWizardState(definition), stepIndex: 1 },
      "detail",
      "hello",
    );
    saveWizardState(state, definition, storage);

    const raw = window.localStorage.getItem(storageKeyFor(definition.id));
    const parsed = JSON.parse(raw as string);
    expect(parsed).toEqual({
      contract: "automation-state/v1",
      workflowId: "example",
      schemaVersion: "1.0",
      currentStageId: "step-two",
      status: "draft",
      answers: { detail: "hello" },
      completedStageIds: [],
      updatedAt: expect.any(String),
    });

    const resumed = loadWizardState(definition, storage);
    expect(resumed.outcome).toBe("resumed");
    expect(resumed.state.stepIndex).toBe(1);
    expect(resumed.state.answers).toEqual({ detail: "hello" });
  });

  it("clears persisted state", () => {
    const storage = createAutomationStorage();
    saveWizardState(createWizardState(definition), definition, storage);
    clearWizardState(definition.id, storage);
    expect(loadWizardState(definition, storage).outcome).toBe("fresh");
  });

  it("resets on corrupt JSON instead of throwing", () => {
    window.localStorage.setItem(storageKeyFor(definition.id), "{not json");
    const storage = createAutomationStorage();
    const result = loadWizardState(definition, storage);
    expect(result.outcome).toBe("reset");
    expect(
      window.localStorage.getItem(storageKeyFor(definition.id)),
    ).toBeNull();
  });

  it("resets when the contract tag does not match", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ contract: "automation-state/v0" })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when the persisted schema version is incompatible", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ schemaVersion: "2.0" })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when currentStageId is not a declared stage", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ currentStageId: "step-nine" })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when status is not one of the declared enum values", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ status: "archived" })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("preserves workflow-owned answer values that are not strings", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({
          answers: { employeeCount: 12, selectedTools: ["CRM"] },
        }),
      ),
    );
    const storage = createAutomationStorage();
    const result = loadWizardState(definition, storage);
    expect(result.outcome).toBe("resumed");
    expect(result.state.answers).toEqual({
      employeeCount: 12,
      selectedTools: ["CRM"],
    });
  });

  it("resets when answers is not a plain object", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ answers: ["not", "an", "object"] })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when completedStageIds contains a non-string element", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ completedStageIds: ["step-one", 2] })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when updatedAt is not a canonical ISO 8601 timestamp", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({ updatedAt: "2026-09-03T04:00:00+00:00" }),
      ),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("resets when updatedAt is not a valid date at all", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ updatedAt: "not-a-date" })),
    );
    const storage = createAutomationStorage();
    expect(loadWizardState(definition, storage).outcome).toBe("reset");
  });

  it("does not throw required-field validation when a workflow-owned answer is not a string", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ answers: { name: 3 } })),
    );
    const storage = createAutomationStorage();
    const { state, outcome } = loadWizardState(definition, storage);
    expect(outcome).toBe("resumed");
    expect(() => goNext(state, definition)).not.toThrow();
  });
});

describe("wizard-state terminal status", () => {
  it("does not modify answers once status is submitted", () => {
    const state = {
      ...createWizardState(definition),
      status: "submitted" as const,
      answers: { name: "Acme" },
    };
    const next = updateAnswer(state, "name", "Changed");
    expect(next.answers).toEqual({ name: "Acme" });
  });

  it("does not modify answers once status is completed", () => {
    const state = {
      ...createWizardState(definition),
      status: "completed" as const,
      answers: { name: "Acme" },
    };
    const next = updateAnswer(state, "name", "Changed");
    expect(next.answers).toEqual({ name: "Acme" });
  });

  it("still allows edits while status is draft", () => {
    const state = createWizardState(definition);
    const next = updateAnswer(state, "name", "Acme");
    expect(next.answers).toEqual({ name: "Acme" });
  });
});

describe("wizard-state persistence: storage fallback", () => {
  it("falls back to in-memory storage when the backing store throws on read", () => {
    const throwingBacking = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    const storage = createAutomationStorage(throwingBacking);

    const result = loadWizardState(definition, storage);
    expect(result.outcome).toBe("fresh");
    expect(result.storageAvailable).toBe(false);
  });

  it("keeps write/read continuity in memory for the session once storage throws", () => {
    const throwingBacking = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
      removeItem: () => {
        throw new Error("unavailable");
      },
    } as unknown as Storage;
    const storage = createAutomationStorage(throwingBacking);

    const state = updateAnswer(createWizardState(definition), "name", "Acme");
    const availableAfterSave = saveWizardState(state, definition, storage);
    expect(availableAfterSave).toBe(false);

    const resumed = loadWizardState(definition, storage);
    expect(resumed.outcome).toBe("resumed");
    expect(resumed.state.answers).toEqual({ name: "Acme" });
    expect(resumed.storageAvailable).toBe(false);
  });

  it("reports unavailable immediately when the backing store is readable but write-protected", () => {
    const readOnlyBacking = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      },
      removeItem: () => {},
    } as unknown as Storage;
    const storage = createAutomationStorage(readOnlyBacking);

    expect(storage.isAvailable).toBe(false);
  });

  it("does not touch the real automation-state key while probing write availability", () => {
    const backing = window.localStorage;
    backing.clear();
    createAutomationStorage(backing);
    expect(backing.getItem(storageKeyFor(definition.id))).toBeNull();
    expect(backing.length).toBe(0);
  });

  it("reports storageAvailable true when the backing store works normally", () => {
    const storage = createAutomationStorage();
    const result = saveWizardState(
      createWizardState(definition),
      definition,
      storage,
    );
    expect(result).toBe(true);
  });

  it("does not corrupt a real workflow record whose id collides with the write-probe key", () => {
    const key = storageKeyFor("__write-probe__");
    const stored = validStoredState({ workflowId: "__write-probe__" });
    window.localStorage.setItem(key, JSON.stringify(stored));

    createAutomationStorage();

    expect(JSON.parse(window.localStorage.getItem(key) as string)).toEqual(
      stored,
    );
  });

  it("fails closed to memory when the probe write succeeds but removing it throws", () => {
    const store = new Map<string, string>();
    const backing = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: () => {
        throw new Error("cleanup blocked");
      },
    } as unknown as Storage;

    const storage = createAutomationStorage(backing);

    expect(storage.isAvailable).toBe(false);
  });

  it("falls back to in-memory storage when window.localStorage itself throws on access", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });

    try {
      const storage = createAutomationStorage();
      const state = updateAnswer(createWizardState(definition), "name", "Acme");
      const availableAfterSave = saveWizardState(state, definition, storage);
      expect(availableAfterSave).toBe(false);

      const resumed = loadWizardState(definition, storage);
      expect(resumed.outcome).toBe("resumed");
      expect(resumed.state.answers).toEqual({ name: "Acme" });
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});
