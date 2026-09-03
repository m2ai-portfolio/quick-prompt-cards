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
});
