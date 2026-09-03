import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { silverPlatterCard } from "../../prompts";
import type { Card } from "../../types";
import { silverPlatterWorkflow } from "./definition";

const cards: Card[] = [silverPlatterCard];
const workflows = { "silver-platter": silverPlatterWorkflow };

beforeEach(() => {
  localStorage.clear();
});

async function openWizard() {
  const user = userEvent.setup();
  render(<App cards={cards} workflows={workflows} />);
  await user.click(
    screen.getByRole("button", {
      name: `Open workflow: ${silverPlatterCard.title}`,
    }),
  );
  return user;
}

async function fillFullSlice(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByLabelText("How much explanation do you want?"),
    "walkthrough",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText("Describe your business or work in 1-2 sentences."),
    "I run a small landscaping crew and quote jobs by phone.",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    // This field also renders a `help` hint inside the same <label>, so the
    // computed accessible name includes that trailing text; match by prefix.
    screen.getByLabelText(/^What's the single hardest/),
    "Writing follow-up quotes after every site visit.",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.selectOptions(
    screen.getByLabelText("Which shape fits this task best?"),
    "auto_draft",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText(/^What should we call this automation\?/),
    "Quote Follow-Up Drafter",
  );
}

describe("Silver Platter card", () => {
  it("is visible in the card list and opens the guided workflow", async () => {
    render(<App cards={cards} workflows={workflows} />);

    expect(
      screen.getByRole("button", {
        name: `Open workflow: ${silverPlatterCard.title}`,
      }),
    ).toBeInTheDocument();
  });

  it("completes the full first slice and displays the given name on the terminal screen", async () => {
    const user = await openWizard();
    await fillFullSlice(user);

    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      screen.getByText(/already been completed and can no longer be edited/),
    ).toBeInTheDocument();
    expect(screen.getByText("Quote Follow-Up Drafter")).toBeInTheDocument();
  });

  it("blocks advancing past a step until its required field is answered", async () => {
    const user = await openWizard();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByText("How much explanation do you want? is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Choose your pace" }),
    ).toBeInTheDocument();
  });

  it("supports back navigation without losing an already-entered answer", async () => {
    const user = await openWizard();

    await user.selectOptions(
      screen.getByLabelText("How much explanation do you want?"),
      "fast_track",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByLabelText<HTMLSelectElement>(
        "How much explanation do you want?",
      ).value,
    ).toBe("fast_track");
  });

  it("saves progress on close and resumes at the same step with the same answers", async () => {
    const user = await openWizard();

    await user.selectOptions(
      screen.getByLabelText("How much explanation do you want?"),
      "walkthrough",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(
      screen.getByLabelText("Describe your business or work in 1-2 sentences."),
      "A two-person bakery that ships nationwide.",
    );
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: `Open workflow: ${silverPlatterCard.title}`,
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Describe your business or work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(
        "Describe your business or work in 1-2 sentences.",
      ).value,
    ).toBe("A two-person bakery that ships nationwide.");
  });

  it("discards incompatible stored state and starts fresh with a visible notice", async () => {
    localStorage.setItem(
      "prompt-pocket:automation-state:v1:silver-platter",
      JSON.stringify({
        contract: "automation-state/v1",
        workflowId: "silver-platter",
        schemaVersion: "0.1",
        currentStageId: "1_speed",
        status: "draft",
        answers: {},
        completedStageIds: [],
        updatedAt: new Date().toISOString(),
      }),
    );

    await openWizard();

    expect(
      screen.getByText(/couldn't resume your previous progress/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Choose your pace" }),
    ).toBeInTheDocument();
  });

  it("never calls a network endpoint while the interview runs (no executor authority)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = await openWizard();
    await fillFullSlice(user);
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
