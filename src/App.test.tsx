import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
});

describe("Prompt Pocket", () => {
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
