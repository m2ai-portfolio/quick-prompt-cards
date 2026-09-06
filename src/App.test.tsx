import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createPromptCard } from "./prompts";
import type { Card, PromptCard } from "./types";
import type { WorkflowDefinition } from "./workflows/types";

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
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

describe("Prompt Pocket", () => {
  it("uses M2AI product branding with a base-safe bundled mark", () => {
    render(<App />);

    expect(
      screen.getByText("M2AI · AI ENHANCEMENT, ENABLEMENT & EXECUTION"),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "M2AI" })).not.toHaveAttribute(
      "src",
      "/m2ai-mark.webp",
    );
  });

  it("shows exactly one canned prompt on the default home", () => {
    render(<App />);

    const promptActions = screen.getAllByRole("button", {
      name: /^run prompt:/i,
    });
    expect(promptActions).toHaveLength(1);
    expect(promptActions[0]).toHaveAccessibleName(
      "Run prompt: Write a clear email",
    );
  });

  it("uses explicit GO actions instead of chevron-only controls", () => {
    render(<App />);

    expect(screen.getAllByText("GO")).toHaveLength(3);
  });

  it("edits a prompt card's category, name, and prompt and keeps the changes", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App cards={[promptCard]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Edit Prompt example" });
    expect(dialog).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Category"), "Business");
    await user.clear(screen.getByLabelText("Card name"));
    await user.type(
      screen.getByLabelText("Card name"),
      "Follow up with a lead",
    );
    await user.clear(screen.getByLabelText("Prompt"));
    await user.type(
      screen.getByLabelText("Prompt"),
      "Draft a concise follow-up using only the details I provide.",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      screen.getByRole("button", { name: "Run prompt: Follow up with a lead" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Business").length).toBeGreaterThan(0);

    unmount();
    render(<App cards={[promptCard]} />);
    await user.click(
      screen.getByRole("button", { name: "Edit Follow up with a lead" }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue(
      "Draft a concise follow-up using only the details I provide.",
    );
  });

  it("moves focus into the editor and restores its trigger after Escape", async () => {
    const user = userEvent.setup();
    render(<App cards={[promptCard]} />);

    const trigger = screen.getByRole("button", { name: "Edit Prompt example" });
    await user.click(trigger);

    expect(
      screen.getByRole("heading", { name: "Edit Prompt example" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("traps Tab and Shift+Tab inside the editor", async () => {
    const user = userEvent.setup();
    render(<App cards={[promptCard]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const saveButton = screen.getByRole("button", { name: "Save changes" });

    saveButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();
  });

  it("runs the locally edited prompt through the clipboard fallback outside Telegram", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<App cards={[promptCard]} />);
    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );
    await user.clear(screen.getByLabelText("Prompt"));
    await user.type(screen.getByLabelText("Prompt"), "Use my edited prompt.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Use my edited prompt."),
    );
  });

  it("never bypasses the Telegram-safe dispatch gate for a locally edited card (contracts/prompt-run-v1.md)", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    window.Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
      },
    };

    try {
      render(<App cards={[promptCard]} />);
      await user.click(
        screen.getByRole("button", { name: "Edit Prompt example" }),
      );
      await user.clear(screen.getByLabelText("Prompt"));
      await user.type(screen.getByLabelText("Prompt"), "Use my edited prompt.");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await user.click(
        screen.getByRole("button", { name: "Run prompt: Prompt example" }),
      );

      await waitFor(() =>
        expect(
          screen.getByText("Couldn't send — reopen Prompt Pocket to try again"),
        ).toBeInTheDocument(),
      );
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      delete window.Telegram;
    }
  });

  it("requires confirmation before deleting an editable prompt card", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App cards={[promptCard]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete card" }));

    const confirmationHeading = screen.getByRole("heading", {
      name: "Delete Prompt example?",
    });
    expect(confirmationHeading).toBeInTheDocument();
    expect(confirmationHeading).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Yes, delete this card" }),
    );
    expect(
      screen.queryByRole("button", { name: "Run prompt: Prompt example" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Choose what you need" }),
      ).toHaveFocus(),
    );

    unmount();
    render(<App cards={[promptCard]} />);
    expect(
      screen.queryByRole("button", { name: "Run prompt: Prompt example" }),
    ).not.toBeInTheDocument();
  });

  it("opens a focused Create a prompt composer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Create a prompt" }));

    expect(
      screen.getByRole("dialog", { name: "Create a prompt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("What should this prompt help you do?"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What should it know?")).toBeInTheDocument();
    expect(
      screen.getByLabelText("How should the answer look?"),
    ).toBeInTheDocument();
  });

  it("creates a personal prompt and pins it for later", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Create a prompt" }));
    await user.type(
      screen.getByLabelText("What should this prompt help you do?"),
      "Turn meeting notes into action items",
    );
    await user.type(
      screen.getByLabelText("What should it know?"),
      "Preserve owners and deadlines",
    );
    await user.type(
      screen.getByLabelText("How should the answer look?"),
      "A prioritized checklist",
    );
    await user.click(screen.getByRole("button", { name: "Create my prompt" }));

    expect(
      screen.getByRole("heading", { name: "Your prompt" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("created-prompt")).toHaveTextContent(
      "Turn meeting notes into action items",
    );
    expect(screen.getByTestId("created-prompt")).toHaveTextContent(
      "Preserve owners and deadlines",
    );

    await user.click(screen.getByRole("button", { name: "Pin this prompt" }));
    expect(
      screen.getByRole("heading", { name: "Pinned prompts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Turn meeting notes into action items"),
    ).toBeInTheDocument();

    unmount();
    render(<App />);
    expect(
      screen.getByText("Turn meeting notes into action items"),
    ).toBeInTheDocument();
  });

  it("copies a pinned prompt to the clipboard outside Telegram", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create a prompt" }));
    await user.type(
      screen.getByLabelText("What should this prompt help you do?"),
      "Turn meeting notes into action items",
    );
    await user.click(screen.getByRole("button", { name: "Create my prompt" }));
    await user.click(screen.getByRole("button", { name: "Pin this prompt" }));

    await user.click(
      screen.getByRole("button", {
        name: "Run prompt: Turn meeting notes into action items",
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it("never falls back to the clipboard for a pinned prompt inside Telegram, and never spends the session's one-shot query_id doing so (contracts/prompt-run-v1.md)", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv(
      "VITE_PROMPT_RUN_ENDPOINT",
      "https://api.example.test/api/prompt-run",
    );
    window.Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
        initData: "auth_date=1&hash=abc&query_id=q1",
        initDataUnsafe: { query_id: "q1" },
      },
    };

    try {
      render(<App cards={[promptCard, createPromptCard]} />);
      await user.click(screen.getByRole("button", { name: "Create a prompt" }));
      await user.type(
        screen.getByLabelText("What should this prompt help you do?"),
        "Turn meeting notes into action items",
      );
      await user.click(
        screen.getByRole("button", { name: "Create my prompt" }),
      );
      await user.click(screen.getByRole("button", { name: "Pin this prompt" }));

      await user.click(
        screen.getByRole("button", {
          name: "Run prompt: Turn meeting notes into action items",
        }),
      );

      await waitFor(() =>
        expect(
          screen.getByText("Couldn't send — reopen Prompt Pocket to try again"),
        ).toBeInTheDocument(),
      );
      expect(writeText).not.toHaveBeenCalled();
      // A pinned/custom prompt can never resolve against the server catalog
      // (contracts/prompt-run-v1.md, "Request"), so a dispatch attempt would
      // be guaranteed to fail and would burn the session's single-use
      // query_id (contracts/prompt-run-v1.md, "Single-use / retry boundary"),
      // silently breaking every other card's dispatch for the rest of the
      // session. The fix must therefore never make the network call at all
      // for a pinned prompt.
      expect(fetchMock).not.toHaveBeenCalled();

      // Confirm the session's query_id survives, so a legitimate catalog
      // card can still dispatch right after the pinned-prompt tap.
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ status: "posted" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Run prompt: Prompt example" }),
      );
      await waitFor(() =>
        expect(screen.getByText("Sent to Telegram")).toBeInTheDocument(),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete window.Telegram;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
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

  it("never falls back to the clipboard inside Telegram when one-tap dispatch is unavailable", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    window.Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
      },
    };

    try {
      render(<App cards={[promptCard]} />);

      expect(
        screen.queryByText(/copies the finished prompt to your clipboard/i),
      ).not.toBeInTheDocument();

      const button = screen.getByRole("button", {
        name: "Run prompt: Prompt example",
      });
      await user.click(button);

      await waitFor(() =>
        expect(
          screen.getByText("Couldn't send — reopen Prompt Pocket to try again"),
        ).toBeInTheDocument(),
      );
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      delete window.Telegram;
    }
  });

  it("opens the generic workflow wizard when a registered workflow card is tapped", async () => {
    const user = userEvent.setup();
    const workflowDefinition: WorkflowDefinition = {
      id: "silver-platter",
      schemaVersion: "1.0",
      title: "Workflow example",
      steps: [
        {
          id: "step-one",
          title: "Step one",
          fields: [],
        },
      ],
    };
    const cards: Card[] = [
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

    render(
      <App
        cards={cards}
        workflows={{ "silver-platter": workflowDefinition }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open workflow: Workflow example" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Workflow example" }),
    ).toBeInTheDocument();
  });

  it("keeps in-memory progress across close and reopen in the same tab when browser storage is blocked", async () => {
    const blockedPrefix = "prompt-pocket:automation-state";
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith(blockedPrefix)) throw new Error("blocked");
      return originalGetItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith(blockedPrefix)) throw new Error("blocked");
      return originalSetItem.call(this, key, value);
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith(blockedPrefix)) throw new Error("blocked");
      return originalRemoveItem.call(this, key);
    });

    const user = userEvent.setup();
    const workflowDefinition: WorkflowDefinition = {
      id: "silver-platter",
      schemaVersion: "1.0",
      title: "Workflow example",
      steps: [
        {
          id: "step-one",
          title: "Step one",
          fields: [
            { key: "name", label: "Name", type: "text", required: true },
          ],
        },
        {
          id: "step-two",
          title: "Step two",
          fields: [{ key: "detail", label: "Detail", type: "text" }],
        },
      ],
    };
    const cards: Card[] = [
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

    render(
      <App
        cards={cards}
        workflows={{ "silver-platter": workflowDefinition }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open workflow: Workflow example" }),
    );
    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open workflow: Workflow example" }),
    );

    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
  });
});
