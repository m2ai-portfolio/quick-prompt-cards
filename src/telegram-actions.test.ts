import { describe, expect, it, vi } from "vitest";
import { deliverPrompt } from "./telegram-actions";

describe("deliverPrompt", () => {
  it("performs no delivery side effect when confirmation is declined", async () => {
    const sendWebAppQuery = vi.fn();
    const copyToClipboard = vi.fn();

    const result = await deliverPrompt("Draft prompt", {
      confirm: async () => false,
      sendWebAppQuery,
      copyToClipboard,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(sendWebAppQuery).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });
});
