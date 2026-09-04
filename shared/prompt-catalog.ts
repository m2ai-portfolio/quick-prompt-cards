/**
 * Canonical stored-prompt catalog. Keep this intentionally small: Prompt
 * Pocket starts with one useful canned prompt, while personal prompts are
 * created and pinned on the device.
 */

export type CatalogPromptCard = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  prompt: string;
  example?: string;
};

export const promptCatalog: CatalogPromptCard[] = [
  {
    id: "clear-email",
    title: "Write a clear email",
    description:
      "Turn rough notes into a warm, polished email that gets to the point.",
    category: "Writing",
    tags: ["email", "message", "rewrite"],
    prompt: `I need help writing a clear, polished email. Before you draft it, ask me for whatever you don't already have: who is receiving it, what I need to say, and how it should sound. Once you have that, write a subject line followed by the email. Keep it concise, preserve every important fact I give you, end with a clear next step, and do not invent details.`,
    example:
      "Use this when you know what you want to say but need help making it clear and polished.",
  },
];
