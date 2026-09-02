import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Card, PromptCard } from "./types";

beforeEach(() => {
  localStorage.clear();
});

const promptCard: PromptCard = {
  id: "prompt-example",
  kind: "prompt",
  title: "Prompt example",
  description: "A prompt card",
  category: "Writing",
  tags: [],
  prompt: "A complete, ready-to-run prompt.",
  action: {
    type: "prompt-delivery",
    requiresConfirmation: false,
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

describe("Prompt Pocket", () => {
  it("uses M2AI product branding", () => {
    render(<App />);

    expect(
      screen.getByText("M2AI · AI ENHANCEMENT, ENABLEMENT & EXECUTION"),
    ).toBeInTheDocument();
  });

  it("does not repeat the prompt type as a decorative badge", () => {
    render(<App />);

    expect(screen.queryAllByText("Prompt")).toHaveLength(0);
  });

  it("renders no prompt fields, builder, preview, copy button, or paste instructions", () => {
    render(<App />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy finished prompt/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/paste it into/i)).not.toBeInTheDocument();
  });

  it("renders a keyboard-discoverable unavailable workflow outcome", async () => {
    const user = userEvent.setup();
    const cards: Card[] = [
      promptCard,
      {
        id: "silver-platter",
        kind: "workflow",
        title: "Workflow example",
        description: "A workflow card",
        category: "Business",
        tags: [],
        workflow: {
          id: "silver-platter",
          schemaVersion: "1.0",
          entryStage: "1_speed",
        },
      },
    ];

    render(<App cards={cards} />);

    const promptAction = screen.getByRole("button", {
      name: "Run prompt: Prompt example",
    });
    const workflowOutcome = screen.getByRole("button", {
      name: "Workflow Workflow example is not available yet",
    });

    expect(promptAction).toBeEnabled();
    expect(workflowOutcome).toBeEnabled();
    expect(workflowOutcome).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Not available yet")).toBeInTheDocument();

    for (
      let step = 0;
      step < 30 && document.activeElement !== workflowOutcome;
      step += 1
    ) {
      await user.tab();
    }
    expect(workflowOutcome).toHaveFocus();
  });

  it("searches cards by title, description, category, and tags", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("searchbox"), "email");
    expect(
      screen.getByRole("button", {
        name: /^run prompt: write a clear email$/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /^run prompt: compare my options$/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("dispatches a card exactly once per tap with no redundant confirmation", async () => {
    const user = userEvent.setup();
    const runPrompt = vi.fn().mockResolvedValue({ status: "dispatched" });

    render(<App cards={[promptCard]} runPrompt={runPrompt} />);

    const button = screen.getByRole("button", {
      name: "Run prompt: Prompt example",
    });
    await user.click(button);

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(runPrompt).toHaveBeenCalledWith(promptCard.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("Sent to Telegram")).toBeInTheDocument(),
    );
  });

  it("ignores a second tap while the first dispatch is still pending", async () => {
    const user = userEvent.setup();
    let resolveDispatch: (() => void) | undefined;
    const runPrompt = vi.fn(
      () =>
        new Promise<{ status: "dispatched" }>((resolve) => {
          resolveDispatch = () => resolve({ status: "dispatched" });
        }),
    );

    render(<App cards={[promptCard]} runPrompt={runPrompt} />);

    const button = screen.getByRole("button", {
      name: "Run prompt: Prompt example",
    });
    await user.click(button);
    await user.click(button);

    expect(runPrompt).toHaveBeenCalledTimes(1);

    resolveDispatch?.();
    await waitFor(() =>
      expect(screen.getByText("Sent to Telegram")).toBeInTheDocument(),
    );
  });

  it("shows an explicit, separate fallback notice outside Telegram", () => {
    render(<App cards={[promptCard]} />);

    expect(
      screen.getByText(/copies the finished prompt to your clipboard/i),
    ).toBeInTheDocument();
  });
});
