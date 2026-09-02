import type { PromptCard } from "./types";

export type RunPromptDependencies = {
  isInTelegram: () => boolean;
  supportsOneTapDispatch: () => boolean;
  sendWebAppQuery: (cardId: string) => Promise<void>;
  copyToClipboard: (prompt: string) => Promise<void>;
};

export type RunPromptResult =
  | { status: "dispatched" }
  | { status: "fallback-copied" }
  | { status: "unavailable" };

/**
 * One card tap is the whole user action, and the clipboard fallback is a
 * plain-browser-only affordance. Telegram presence and dispatch capability
 * are detected separately: inside Telegram without one-tap dispatch shipped,
 * a tap must surface an honest "unavailable" result asking for a fresh
 * launch, never silently fall back to the clipboard.
 */
export async function runPrompt(
  card: PromptCard,
  dependencies: RunPromptDependencies,
): Promise<RunPromptResult> {
  if (dependencies.supportsOneTapDispatch()) {
    await dependencies.sendWebAppQuery(card.id);
    return { status: "dispatched" };
  }

  if (dependencies.isInTelegram()) {
    return { status: "unavailable" };
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
