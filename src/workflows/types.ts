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
};

export type WizardAnswers = Record<string, string>;

export const WIZARD_STATE_VERSION = 1;

export type PersistedWizardStateV1 = {
  version: typeof WIZARD_STATE_VERSION;
  workflowId: string;
  schemaVersion: string;
  stepIndex: number;
  answers: WizardAnswers;
  updatedAt: string;
};

export type WizardState = {
  workflowId: string;
  schemaVersion: string;
  stepIndex: number;
  answers: WizardAnswers;
  errors: Record<string, string>;
};
