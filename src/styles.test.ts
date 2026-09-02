import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");

function parseColors(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(
      ([, name, value]) => [name, value],
    ),
  );
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const channels = hex.match(/[\da-f]{2}/gi);
  if (!channels || channels.length !== 3)
    throw new Error(`Invalid color ${hex}`);
  const [red, green, blue] = channels.map((value) =>
    channel(parseInt(value, 16)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const lightBlock = styles.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const darkBlock =
  styles.match(
    /@media \(prefers-color-scheme: dark\)[\s\S]*?:root\s*\{([\s\S]*?)\n\s*\}/,
  )?.[1] ?? "";

describe("M2AI design tokens", () => {
  it("keeps the approved palette available", () => {
    expect(styles).toContain("--m2ai-cyan: #06b6d4;");
    expect(styles).toContain("--m2ai-teal: #14b8a6;");
    expect(styles).toContain("--m2ai-orange: #e85d04;");
  });

  it.each([
    ["light", parseColors(lightBlock)],
    ["dark", parseColors(darkBlock)],
  ])("uses contrast-safe semantic colors in the %s theme", (_theme, colors) => {
    expect(colors).toMatchObject({
      accent: expect.any(String),
      "accent-ink": expect.any(String),
      focus: expect.any(String),
      surface: expect.any(String),
    });
    expect(contrast(colors.accent, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colors["accent-ink"], colors.accent),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.focus, colors.surface)).toBeGreaterThanOrEqual(3);
  });

  it("renders the focus indicator at its opaque semantic color", () => {
    expect(styles).toContain("outline: 3px solid var(--focus);");
  });
});
