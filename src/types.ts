export type PromptField = {
  key: string;
  label: string;
  placeholder: string;
  help?: string;
  multiline?: boolean;
};

export type BaseCard = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
};

export type PromptDeliveryAction = {
  type: "prompt-delivery";
  requiresConfirmation: true;
  preferred: "telegram-webapp-query";
  fallback: "clipboard";
};

export type PromptCard = BaseCard & {
  kind: "prompt";
  template: string;
  fields: PromptField[];
  action: PromptDeliveryAction;
  example?: string;
};

export type WorkflowCard = BaseCard & {
  kind: "workflow";
  workflow: {
    id: "silver-platter";
    schemaVersion: "1.0";
    entryStage: "1_speed";
  };
};

export type Card = PromptCard | WorkflowCard;
