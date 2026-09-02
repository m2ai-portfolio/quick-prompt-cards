export type CardKind = "prompt" | "workflow";

export type BaseCard = {
  id: string;
  kind: CardKind;
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
  prompt: string;
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
