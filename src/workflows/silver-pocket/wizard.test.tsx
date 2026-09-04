import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { silverPocketCard } from "../../prompts";
import type { Card } from "../../types";
import { silverPocketWorkflow } from "./definition";

const cards: Card[] = [silverPocketCard];
const workflows = { "silver-pocket": silverPocketWorkflow };

beforeEach(() => {
  localStorage.clear();
});

async function openWizard() {
  const user = userEvent.setup();
  render(<App cards={cards} workflows={workflows} />);
  await user.click(
    screen.getByRole("button", {
      name: `Open workflow: ${silverPocketCard.title}`,
    }),
  );
  return user;
}

async function fillTask(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText(/^What recurring task do you want help with\?/),
    "Turn meeting notes into follow-up tasks.",
  );
}

async function fillFullWorkflow(user: ReturnType<typeof userEvent.setup>) {
  await fillTask(user);
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText("What starts this task?"),
    "A client meeting ends.",
  );
  await user.type(
    screen.getByLabelText("What do you do today from start to finish?"),
    "Read the transcript, list decisions, then create assigned tasks.",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText(/^What information, apps, or tools are involved\?/),
    "A meeting transcript in Google Drive and a task board in Notion.",
  );
  await user.type(
    screen.getByLabelText("What should the automation produce or update?"),
    "Create a reviewed list of assigned follow-up tasks.",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText(/^What should a person review or approve\?/),
    "A person reviews owners and deadlines before tasks are created.",
  );
  await user.type(
    screen.getByLabelText(/^What should this automation never do on its own\?/),
    "Never message clients or publish notes.",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(
    screen.getByLabelText(/^What should we call this automation\?/),
    "Meeting Follow-Up Pocket",
  );
}

describe("Silver Pocket card", () => {
  it("is visible in the card list and opens the guided workflow", async () => {
    render(<App cards={cards} workflows={workflows} />);

    expect(
      screen.getByRole("button", {
        name: `Open workflow: ${silverPocketCard.title}`,
      }),
    ).toBeInTheDocument();
  });

  it("completes the full workflow and displays the given name", async () => {
    const user = await openWizard();
    await fillFullWorkflow(user);

    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      screen.getByText(/already been completed and can no longer be edited/),
    ).toBeInTheDocument();
    expect(screen.getByText("Meeting Follow-Up Pocket")).toBeInTheDocument();
  });

  it("starts with one provider-neutral task question", async () => {
    await openWizard();

    expect(
      screen.getByRole("heading", { name: "Choose the task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^What recurring task do you want help with\?/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude|Anthropic/i)).not.toBeInTheDocument();
  });

  it("blocks advancing until the required task is answered", async () => {
    const user = await openWizard();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByText(
        "What recurring task do you want help with? is required.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Choose the task" }),
    ).toBeInTheDocument();
  });

  it("supports back navigation without losing an entered answer", async () => {
    const user = await openWizard();
    await fillTask(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByLabelText<HTMLTextAreaElement>(
        /^What recurring task do you want help with\?/,
      ).value,
    ).toBe("Turn meeting notes into follow-up tasks.");
  });

  it("saves progress on close and resumes at the same step", async () => {
    const user = await openWizard();
    await fillTask(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(
      screen.getByLabelText("What starts this task?"),
      "A client meeting ends.",
    );
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(
      screen.getByRole("button", {
        name: `Open workflow: ${silverPocketCard.title}`,
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Map what happens today" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("What starts this task?")
        .value,
    ).toBe("A client meeting ends.");
  });

  it("discards incompatible stored state and starts fresh visibly", async () => {
    localStorage.setItem(
      "prompt-pocket:automation-state:v1:silver-pocket",
      JSON.stringify({
        contract: "automation-state/v1",
        workflowId: "silver-pocket",
        schemaVersion: "1.0",
        currentStageId: "task",
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
      screen.getByRole("heading", { name: "Choose the task" }),
    ).toBeInTheDocument();
  });

  it("never calls a network endpoint while the workflow runs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = await openWizard();
    await fillFullWorkflow(user);
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
