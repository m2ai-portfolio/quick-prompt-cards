import type { PromptCard } from "./types";

export type RunPromptDependencies = {
  isTelegramSupported: () => boolean;
  sendWebAppQuery: (cardId: string) => Promise<void>;
  copyToClipboard: (prompt: string) => Promise<void>;
};

export type RunPromptResult =
  { status: "dispatched" } | { status: "fallback-copied" };

/**
 * One card tap is the whole user action: it either dispatches the stored
 * prompt straight into the Telegram chat, or, outside a supported Telegram
 * launch, copies the finished prompt as an explicit fallback. There is no
 * second confirmation step.
 */
export async function runPrompt(
  card: PromptCard,
  dependencies: RunPromptDependencies,
): Promise<RunPromptResult> {
  if (dependencies.isTelegramSupported()) {
    await dependencies.sendWebAppQuery(card.id);
    return { status: "dispatched" };
  }

  await dependencies.copyToClipboard(card.prompt);
  return { status: "fallback-copied" };
}

/**
 * The A3 posting adapter (validated Telegram init data -> server-resolved
 * prompt -> Web App query answer) has not shipped yet. Until it does, no
 * launch context is treated as supporting one-tap dispatch, so every tap
 * uses the explicit clipboard fallback instead of failing silently.
 */
export function isTelegramWebAppSupported(): boolean {
  return false;
}

export async function sendWebAppQuery(cardId: string): Promise<void> {
  throw new Error(
    `Telegram prompt dispatch for "${cardId}" requires the A3 posting adapter, which has not shipped yet.`,
  );
}

export async function copyPromptToClipboard(prompt: string): Promise<void> {
  await navigator.clipboard.writeText(prompt);
}
