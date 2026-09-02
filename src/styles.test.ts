import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");

describe("M2AI design tokens", () => {
  it("defines the approved cyan, teal, and orange accents", () => {
    expect(styles).toContain("--m2ai-cyan: #06b6d4;");
    expect(styles).toContain("--m2ai-teal: #14b8a6;");
    expect(styles).toContain("--m2ai-orange: #e85d04;");
  });
});
