import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  window.localStorage.clear();
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

  it("saves progress locally and resumes on remount", async () => {
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
    unmount();

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Step two" }),
    ).toBeInTheDocument();
  });

  it("resets to a fresh wizard when persisted state is corrupt", () => {
    window.localStorage.setItem(storageKeyFor(definition.id), "{not json");

    render(<WorkflowWizard definition={definition} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Step one" }),
    ).toBeInTheDocument();
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
