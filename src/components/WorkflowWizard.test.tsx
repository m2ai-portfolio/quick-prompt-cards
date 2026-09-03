import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowWizard from "./WorkflowWizard";
import { storageKeyFor } from "../workflows/wizard-state";
import type { WorkflowDefinition } from "../workflows/types";

const definition: WorkflowDefinition = {
  id: "example",
  schemaVersion: "1.0",
  title: "Example workflow",
  steps: [
    {
      id: "step-one",
      title: "Step one",
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
    },
    {
      id: "step-two",
      title: "Step two",
      fields: [{ key: "detail", label: "Detail", type: "text" }],
    },
  ],
};

function validStoredState(overrides: Record<string, unknown> = {}) {
  return {
    contract: "automation-state/v1",
    workflowId: definition.id,
    schemaVersion: definition.schemaVersion,
    currentStageId: "step-two",
    status: "draft",
    answers: {},
    completedStageIds: ["step-one"],
    updatedAt: "2026-09-03T04:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkflowWizard", () => {
  it("renders as an accessible dialog showing the first step", () => {
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Example workflow" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
  });

  it("blocks moving to the next step when a required field is empty", async () => {
    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
  });

  it("advances and goes back once the required field is filled", async () => {
    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
  });

  it("closes via the close button and calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WorkflowWizard definition={definition} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WorkflowWizard definition={definition} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves progress locally in the automation-state/v1 contract shape and resumes on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <WorkflowWizard definition={definition} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(
        window.localStorage.getItem(storageKeyFor(definition.id)),
      ).not.toBeNull(),
    );
    const raw = window.localStorage.getItem(storageKeyFor(definition.id));
    const parsed = JSON.parse(raw as string);
    expect(parsed).toMatchObject({
      contract: "automation-state/v1",
      workflowId: "example",
      schemaVersion: "1.0",
      currentStageId: "step-two",
      status: "draft",
      answers: { name: "Acme" },
      completedStageIds: ["step-one"],
    });

    unmount();

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
  });

  it("resets to a fresh wizard and shows a recovery notice when persisted state is corrupt JSON", () => {
    window.localStorage.setItem(storageKeyFor(definition.id), "{not json");

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/couldn.t resume your previous progress/i),
    ).toBeInTheDocument();
  });

  it("resets and shows the recovery notice when persisted state does not match the frozen contract", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState({ currentStageId: "unknown-stage" })),
    );

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/couldn.t resume your previous progress/i),
    ).toBeInTheDocument();
  });

  it("resumes silently, without the recovery notice, when persisted state matches the frozen contract", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(validStoredState()),
    );

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn.t resume your previous progress/i),
    ).not.toBeInTheDocument();
  });

  it("shows an upfront persistence warning and keeps working when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByText(/progress can.t be saved right now/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
  });

  it("shows the upfront persistence warning before typing when storage is readable but write-protected", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByText(/progress can.t be saved right now/i),
    ).toBeInTheDocument();
  });

  it("does not show the persistence warning when storage works normally", () => {
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.queryByText(/progress can.t be saved right now/i),
    ).not.toBeInTheDocument();
  });

  it("moves focus to the new step heading instead of an input after navigating", async () => {
    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("heading", { name: "Step two" })).toHaveFocus();
  });

  it("supports full keyboard operation for next and back", async () => {
    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.tab();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
  });

  it("renders a select field as a select control with its options", () => {
    const selectDefinition: WorkflowDefinition = {
      id: "select-example",
      schemaVersion: "1.0",
      title: "Select workflow",
      steps: [
        {
          id: "step-one",
          title: "Step one",
          fields: [
            {
              key: "tone",
              label: "Tone",
              type: "select",
              options: [
                { value: "casual", label: "Casual" },
                { value: "formal", label: "Formal" },
              ],
            },
          ],
        },
      ],
    };

    render(<WorkflowWizard definition={selectDefinition} onClose={vi.fn()} />);

    const select = screen.getByLabelText("Tone");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Casual" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Formal" })).toBeInTheDocument();
  });

  it("traps Tab focus within the dialog", async () => {
    const user = userEvent.setup();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    const closeButton = screen.getByRole("button", { name: "Close" });
    const nextButton = screen.getByRole("button", { name: "Next" });

    nextButton.focus();
    expect(nextButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it("renders a submitted workflow as read-only instead of an editable draft", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({
          status: "submitted",
          currentStageId: "step-one",
          answers: { name: "Acme" },
        }),
      ),
    );

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText(/already been submitted/i)).toBeInTheDocument();
  });

  it("does not render Next/Back controls for a completed workflow", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({ status: "completed", currentStageId: "step-one" }),
      ),
    );

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/already been completed/i)).toBeInTheDocument();
  });

  it("finishing the wizard persists a terminal record and does not reopen as an editable draft", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <WorkflowWizard definition={definition} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() =>
      expect(screen.getByText(/already been completed/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Finish" }),
    ).not.toBeInTheDocument();

    const raw = window.localStorage.getItem(storageKeyFor(definition.id));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ status: "completed" });

    unmount();
    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Finish" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/already been completed/i)).toBeInTheDocument();
  });

  it("lets the user explicitly restart a finished workflow into a fresh draft", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({ status: "completed", currentStageId: "step-two" }),
      ),
    );

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(screen.getByText(/already been completed/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(
      screen.queryByText(/already been completed/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
    expect(
      window.localStorage.getItem(storageKeyFor(definition.id)),
    ).toBeNull();
  });

  it("renders a workflow-owned answer with a non-callable toString instead of crashing", () => {
    window.localStorage.setItem(
      storageKeyFor(definition.id),
      JSON.stringify(
        validStoredState({
          status: "draft",
          currentStageId: "step-one",
          answers: { name: Object.create(null) },
        }),
      ),
    );

    expect(() =>
      render(<WorkflowWizard definition={definition} onClose={vi.fn()} />),
    ).not.toThrow();
    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
  });

  it("does not overwrite the persisted terminal record when reopened", () => {
    const stored = validStoredState({
      status: "submitted",
      currentStageId: "step-one",
      answers: { name: "Acme" },
    });
    const key = storageKeyFor(definition.id);
    window.localStorage.setItem(key, JSON.stringify(stored));

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(JSON.parse(window.localStorage.getItem(key) as string)).toEqual(
      stored,
    );
  });

  it("restores focus to the previously focused element on unmount", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(
      <WorkflowWizard definition={definition} onClose={vi.fn()} />,
    );
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();

    opener.remove();
  });
});
