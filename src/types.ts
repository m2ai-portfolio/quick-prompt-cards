export type CardKind = "prompt" | "creator" | "workflow";

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
  preferred: "telegram-webapp-query";
  fallback: "clipboard";
};

export type PromptCard = BaseCard & {
  kind: "prompt";
  prompt: string;
  action: PromptDeliveryAction;
  example?: string;
};

export type CreatorCard = BaseCard & {
  kind: "creator";
};

export type WorkflowCard = BaseCard & {
  kind: "workflow";
  workflow: {
    id: string;
    schemaVersion: string;
    entryStage: string;
  };
};

export type Card = PromptCard | CreatorCard | WorkflowCard;
