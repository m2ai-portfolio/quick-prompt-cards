import { describe, expect, it, vi } from "vitest";
import { runPrompt } from "./telegram-actions";
import type { PromptCard } from "./types";

const card: PromptCard = {
  id: "clear-email",
  kind: "prompt",
  title: "Write a clear email",
  description: "Turn rough notes into a polished email.",
  category: "Writing",
  tags: ["email"],
  prompt: "Help me write a clear email.",
  action: {
    type: "prompt-delivery",
    requiresConfirmation: false,
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

describe("runPrompt", () => {
  it("dispatches the card exactly once with no confirmation step when Telegram is supported", async () => {
    const sendWebAppQuery = vi.fn().mockResolvedValue(undefined);
    const copyToClipboard = vi.fn();

    const result = await runPrompt(card, {
      isTelegramSupported: () => true,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "dispatched" });
    expect(sendWebAppQuery).toHaveBeenCalledTimes(1);
    expect(sendWebAppQuery).toHaveBeenCalledWith(card.id);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("falls back to an explicit clipboard copy exactly once when Telegram is not supported", async () => {
    const sendWebAppQuery = vi.fn();
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);

    const result = await runPrompt(card, {
      isTelegramSupported: () => false,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "fallback-copied" });
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(card.prompt);
    expect(sendWebAppQuery).not.toHaveBeenCalled();
  });
});
