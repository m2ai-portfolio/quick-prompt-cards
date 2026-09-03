import {
  AUTOMATION_STATE_CONTRACT,
  WIZARD_STATUSES,
  type AutomationStateV1,
  type WizardLoadOutcome,
  type WizardState,
  type WorkflowDefinition,
} from "./types";

export function storageKeyFor(workflowId: string): string {
  return `prompt-pocket:automation-state:v1:${workflowId}`;
}

export function createWizardState(definition: WorkflowDefinition): WizardState {
  return {
    workflowId: definition.id,
    schemaVersion: definition.schemaVersion,
    stepIndex: 0,
    status: "draft",
    answers: {},
    completedStageIds: [],
    errors: {},
  };
}

export function validateStep(
  state: WizardState,
  definition: WorkflowDefinition,
): Record<string, string> {
  const step = definition.steps[state.stepIndex];
  if (!step) return {};

  const errors: Record<string, string> = {};
  for (const field of step.fields) {
    if (field.required && !state.answers[field.key]?.trim()) {
      errors[field.key] = `${field.label} is required.`;
    }
  }
  return errors;
}

export function goNext(
  state: WizardState,
  definition: WorkflowDefinition,
): WizardState {
  const errors = validateStep(state, definition);
  if (Object.keys(errors).length > 0) {
    return { ...state, errors };
  }

  const currentStep = definition.steps[state.stepIndex];
  const completedStageIds =
    currentStep && !state.completedStageIds.includes(currentStep.id)
      ? [...state.completedStageIds, currentStep.id]
      : state.completedStageIds;

  const nextIndex = Math.min(state.stepIndex + 1, definition.steps.length - 1);
  return { ...state, stepIndex: nextIndex, completedStageIds, errors: {} };
}

export function goBack(state: WizardState): WizardState {
  return {
    ...state,
    stepIndex: Math.max(state.stepIndex - 1, 0),
    errors: {},
  };
}

export function updateAnswer(
  state: WizardState,
  key: string,
  value: string,
): WizardState {
  return {
    ...state,
    answers: { ...state.answers, [key]: value },
  };
}

export function isLastStep(
  state: WizardState,
  definition: WorkflowDefinition,
): boolean {
  return state.stepIndex === definition.steps.length - 1;
}

export function serializeAutomationState(
  state: WizardState,
  definition: WorkflowDefinition,
): AutomationStateV1 {
  const stage = definition.steps[state.stepIndex] ?? definition.steps[0];
  return {
    contract: AUTOMATION_STATE_CONTRACT,
    workflowId: state.workflowId,
    schemaVersion: state.schemaVersion,
    currentStageId: stage.id,
    status: state.status,
    answers: state.answers,
    completedStageIds: state.completedStageIds,
    updatedAt: new Date().toISOString(),
  };
}

// Guards every localStorage read/write/remove against throwing storage
// (private browsing, quota exhaustion, disabled storage). Once a call
// throws, the adapter treats storage as unavailable for its remaining
// lifetime and serves an in-memory map instead, per the contract's
// "falls back to in-memory-only state for that session" fallback boundary.
export type AutomationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly isAvailable: boolean;
};

export function createAutomationStorage(
  backing: Storage = window.localStorage,
): AutomationStorage {
  const memory = new Map<string, string>();
  let available = true;

  return {
    get isAvailable() {
      return available;
    },
    getItem(key) {
      if (!available) return memory.get(key) ?? null;
      try {
        return backing.getItem(key);
      } catch {
        available = false;
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      if (!available) {
        memory.set(key, value);
        return;
      }
      try {
        backing.setItem(key, value);
      } catch {
        available = false;
        memory.set(key, value);
      }
    },
    removeItem(key) {
      if (!available) {
        memory.delete(key);
        return;
      }
      try {
        backing.removeItem(key);
      } catch {
        available = false;
        memory.delete(key);
      }
    },
  };
}

export function saveWizardState(
  state: WizardState,
  definition: WorkflowDefinition,
  storage: AutomationStorage,
): boolean {
  storage.setItem(
    storageKeyFor(state.workflowId),
    JSON.stringify(serializeAutomationState(state, definition)),
  );
  return storage.isAvailable;
}

export function clearWizardState(
  workflowId: string,
  storage: AutomationStorage,
): boolean {
  storage.removeItem(storageKeyFor(workflowId));
  return storage.isAvailable;
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function isValidStatus(value: unknown): value is AutomationStateV1["status"] {
  return (
    typeof value === "string" && (WIZARD_STATUSES as string[]).includes(value)
  );
}

function isValidAnswers(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (answer) => typeof answer === "string",
  );
}

function isValidCompletedStageIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

// Whole-object validation per the frozen contract: any single field failing
// its check discards the entire object (no field-by-field salvage).
function isAutomationStateV1(
  value: unknown,
  definition: WorkflowDefinition,
): value is AutomationStateV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.contract !== AUTOMATION_STATE_CONTRACT) return false;
  if (candidate.workflowId !== definition.id) return false;
  if (candidate.schemaVersion !== definition.schemaVersion) return false;
  if (typeof candidate.currentStageId !== "string") return false;
  if (!definition.steps.some((step) => step.id === candidate.currentStageId)) {
    return false;
  }
  if (!isValidStatus(candidate.status)) return false;
  if (!isValidAnswers(candidate.answers)) return false;
  if (!isValidCompletedStageIds(candidate.completedStageIds)) return false;
  if (!isValidTimestamp(candidate.updatedAt)) return false;

  return true;
}

export type WizardLoadResult = {
  state: WizardState;
  outcome: WizardLoadOutcome;
  storageAvailable: boolean;
};

export function loadWizardState(
  definition: WorkflowDefinition,
  storage: AutomationStorage,
): WizardLoadResult {
  const key = storageKeyFor(definition.id);
  const raw = storage.getItem(key);

  if (!raw) {
    return {
      state: createWizardState(definition),
      outcome: "fresh",
      storageAvailable: storage.isAvailable,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return {
      state: createWizardState(definition),
      outcome: "reset",
      storageAvailable: storage.isAvailable,
    };
  }

  if (!isAutomationStateV1(parsed, definition)) {
    storage.removeItem(key);
    return {
      state: createWizardState(definition),
      outcome: "reset",
      storageAvailable: storage.isAvailable,
    };
  }

  const stepIndex = definition.steps.findIndex(
    (step) => step.id === parsed.currentStageId,
  );

  return {
    state: {
      workflowId: parsed.workflowId,
      schemaVersion: parsed.schemaVersion,
      stepIndex,
      status: parsed.status,
      answers: parsed.answers,
      completedStageIds: parsed.completedStageIds,
      errors: {},
    },
    outcome: "resumed",
    storageAvailable: storage.isAvailable,
  };
}
