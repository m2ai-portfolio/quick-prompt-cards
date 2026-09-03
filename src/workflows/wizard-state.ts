import {
  WIZARD_STATE_VERSION,
  type PersistedWizardStateV1,
  type WizardState,
  type WorkflowDefinition,
} from "./types";

export function storageKeyFor(workflowId: string): string {
  return `prompt-pocket-workflow:${workflowId}`;
}

export function createWizardState(definition: WorkflowDefinition): WizardState {
  return {
    workflowId: definition.id,
    schemaVersion: definition.schemaVersion,
    stepIndex: 0,
    answers: {},
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

  const nextIndex = Math.min(state.stepIndex + 1, definition.steps.length - 1);
  return { ...state, stepIndex: nextIndex, errors: {} };
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

export function serializeWizardState(
  state: WizardState,
): PersistedWizardStateV1 {
  return {
    version: WIZARD_STATE_VERSION,
    workflowId: state.workflowId,
    schemaVersion: state.schemaVersion,
    stepIndex: state.stepIndex,
    answers: state.answers,
    updatedAt: new Date().toISOString(),
  };
}

type ReadableStorage = Pick<Storage, "getItem" | "removeItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function saveWizardState(
  state: WizardState,
  storage: WritableStorage = window.localStorage,
): void {
  storage.setItem(
    storageKeyFor(state.workflowId),
    JSON.stringify(serializeWizardState(state)),
  );
}

export function clearWizardState(
  workflowId: string,
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(storageKeyFor(workflowId));
}

function isPersistedWizardStateV1(
  value: unknown,
): value is PersistedWizardStateV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === WIZARD_STATE_VERSION &&
    typeof candidate.workflowId === "string" &&
    typeof candidate.schemaVersion === "string" &&
    typeof candidate.stepIndex === "number" &&
    typeof candidate.answers === "object" &&
    candidate.answers !== null &&
    typeof candidate.updatedAt === "string"
  );
}

export function loadWizardState(
  definition: WorkflowDefinition,
  storage: ReadableStorage = window.localStorage,
): WizardState | null {
  const key = storageKeyFor(definition.id);
  const raw = storage.getItem(key);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return null;
  }

  const isCompatible =
    isPersistedWizardStateV1(parsed) &&
    parsed.workflowId === definition.id &&
    parsed.schemaVersion === definition.schemaVersion &&
    parsed.stepIndex >= 0 &&
    parsed.stepIndex < definition.steps.length;

  if (!isCompatible) {
    storage.removeItem(key);
    return null;
  }

  const persisted = parsed as PersistedWizardStateV1;
  return {
    workflowId: persisted.workflowId,
    schemaVersion: persisted.schemaVersion,
    stepIndex: persisted.stepIndex,
    answers: persisted.answers,
    errors: {},
  };
}
