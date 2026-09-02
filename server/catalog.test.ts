// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveCard } from "./catalog";
import { promptCatalog } from "../shared/prompt-catalog";

describe("resolveCard", () => {
  it("resolves a known card id from the canonical catalog", () => {
    const known = promptCatalog[0];

    const result = resolveCard(known.id);

    expect(result).toEqual(known);
  });

  it("returns undefined for an unknown card id", () => {
    const result = resolveCard("does-not-exist");

    expect(result).toBeUndefined();
  });
});
