export type WorkflowFieldType = "text" | "textarea" | "select";

export type WorkflowFieldOption = {
  value: string;
  label: string;
};

export type WorkflowField = {
  key: string;
  label: string;
  type: WorkflowFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: WorkflowFieldOption[];
};

export type WorkflowStep = {
  id: string;
  title: string;
  description?: string;
  fields: WorkflowField[];
};

export type WorkflowDefinition = {
  id: string;
  schemaVersion: string;
  title: string;
  steps: WorkflowStep[];
  validateAnswers?: (
    answers: WizardAnswers,
    mode: "draft" | "completion",
  ) => Record<string, string>;
};

// Workflow-owned shape (contract rule 5): the generic engine only checks
// that this is a plain object container, never the shape of its values.
export type WizardAnswers = Record<string, unknown>;

export const AUTOMATION_STATE_CONTRACT = "automation-state/v1" as const;

export type WizardStatus =
  "draft" | "review" | "submitted" | "completed" | "blocked";

export const WIZARD_STATUSES: readonly WizardStatus[] = [
  "draft",
  "review",
  "submitted",
  "completed",
  "blocked",
];

// A submitted/completed record is terminal: the contract's single-use/retry
// boundary forbids silently reopening it as an editable draft.
export function isTerminalStatus(status: WizardStatus): boolean {
  return status === "submitted" || status === "completed";
}

// Frozen contract (contracts/automation-state-v1.md). Every field is required
// and validated as a whole object: partial-field salvage is never attempted.
export type AutomationStateV1 = {
  contract: typeof AUTOMATION_STATE_CONTRACT;
  workflowId: string;
  schemaVersion: string;
  currentStageId: string;
  status: WizardStatus;
  answers: WizardAnswers;
  completedStageIds: string[];
  updatedAt: string;
};

export type WizardState = {
  workflowId: string;
  schemaVersion: string;
  stepIndex: number;
  status: WizardStatus;
  answers: WizardAnswers;
  completedStageIds: string[];
  errors: Record<string, string>;
};

// resumed: valid matching state found; fresh: nothing stored; reset: stored
// state failed contract validation and was discarded (contract "outcomes" table).
export type WizardLoadOutcome = "resumed" | "fresh" | "reset";
