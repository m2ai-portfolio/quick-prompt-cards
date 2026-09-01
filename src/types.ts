export type PromptField = {
  key: string;
  label: string;
  placeholder: string;
  help?: string;
  multiline?: boolean;
};

export type PromptCard = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  template: string;
  fields: PromptField[];
  example?: string;
};
