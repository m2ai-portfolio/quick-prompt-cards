import { beforeEach, describe, expect, it } from "vitest";
import {
  createWizardState,
  goBack,
  goNext,
  updateAnswer,
  clearWizardState,
  loadWizardState,
  saveWizardState,
  storageKeyFor,
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

describe("wizard-state persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadWizardState(definition)).toBeNull();
  });

  it("saves and resumes the step index and answers", () => {
    const state = updateAnswer(
      { ...createWizardState(definition), stepIndex: 1 },
      "detail",
      "hello",
    );
    saveWizardState(state);

    const resumed = loadWizardState(definition);
    expect(resumed?.stepIndex).toBe(1);
    expect(resumed?.answers).toEqual({ detail: "hello" });
  });

  it("clears persisted state", () => {
    saveWizardState(createWizardState(definition));
    clearWizardState(definition.id);
    expect(loadWizardState(definition)).toBeNull();
  });

  it("resets on corrupt JSON instead of throwing", () => {
    window.localStorage.setItem(storageKeyFor(definition.id), "{not json");
    expect(loadWizardState(definition)).toBeNull();
    expect(
      window.localStorage.getItem(storageKeyFor(definition.id)),
    ).toBeNull();
  });

  it("resets when the persisted schema version is incompatible", () => {
    saveWizardState(createWizardState(definition));
    const raw = window.localStorage.getItem(storageKeyFor(definition.id));
    const parsed = JSON.parse(raw as string);
    parsed.schemaVersion = "2.0";
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(parsed),
    );

    expect(loadWizardState(definition)).toBeNull();
    expect(
      window.localStorage.getItem(storageKeyFor(definition.id)),
    ).toBeNull();
  });

  it("resets when the persisted step index is out of range", () => {
    saveWizardState(createWizardState(definition));
    const raw = window.localStorage.getItem(storageKeyFor(definition.id));
    const parsed = JSON.parse(raw as string);
    parsed.stepIndex = 99;
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(parsed),
    );

    expect(loadWizardState(definition)).toBeNull();
  });
});
