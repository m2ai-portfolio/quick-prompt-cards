import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import type { Card } from "./types";

beforeEach(() => {
  localStorage.clear();
});

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

  it("renders distinct accessible actions for prompt and workflow cards", () => {
    const cards: Card[] = [
      {
        id: "prompt-example",
        kind: "prompt",
        title: "Prompt example",
        description: "A prompt card",
        category: "Writing",
        tags: [],
        template: "Example",
        fields: [],
        action: {
          type: "prompt-delivery",
          requiresConfirmation: true,
          preferred: "telegram-webapp-query",
          fallback: "clipboard",
        },
      },
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

    expect(
      screen.getByRole("button", { name: "Open prompt: Prompt example" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Workflow Workflow example is not available yet",
      }),
    ).toBeDisabled();
  });

  it("searches cards and builds a copy-ready prompt from guided answers", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("searchbox"), "email");
    expect(
      screen.getByRole("button", { name: /^open write a clear email$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^open compare my options$/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /^open write a clear email$/i }),
    );
    await user.type(
      screen.getByLabelText(/what do you need to say/i),
      "The appointment moved to Friday.",
    );
    await user.type(screen.getByLabelText(/who will receive it/i), "A client");
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName === "PRE" &&
          content.includes("The appointment moved to Friday."),
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /copy finished prompt/i }),
    );
    expect(screen.getByText(/copied and ready/i)).toBeInTheDocument();
  });
});
