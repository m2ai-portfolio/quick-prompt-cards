// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BotRegistryConfigError, loadBotRegistry } from "./bot-registry";

const TWO_BOTS = {
  PROMPT_POCKET_BOTS: "hermes1,beth",
  PROMPT_POCKET_BOT_HERMES1_TOKEN: "fake-token-hermes1",
  PROMPT_POCKET_BOT_HERMES1_USERNAME: "m2ai_hermes1_bot",
  PROMPT_POCKET_BOT_BETH_TOKEN: "fake-token-beth",
  PROMPT_POCKET_BOT_BETH_USERNAME: "M2ai_beth_bot",
};

describe("loadBotRegistry", () => {
  it("parses the ordered enabled list and resolves tokens per key", () => {
    const registry = loadBotRegistry(TWO_BOTS);

    expect(registry.list()).toEqual([
      { key: "hermes1", username: "m2ai_hermes1_bot", enabled: true },
      { key: "beth", username: "M2ai_beth_bot", enabled: true },
    ]);
    expect(registry.resolve("hermes1")).toEqual({
      key: "hermes1",
      username: "m2ai_hermes1_bot",
      token: "fake-token-hermes1",
    });
    expect(registry.resolve("beth")?.token).toBe("fake-token-beth");
    expect(registry.dispatchDisabled).toBe(false);
  });

  it("never exposes a token through the readback list", () => {
    const registry = loadBotRegistry(TWO_BOTS);
    const serialized = JSON.stringify(registry.list());

    expect(serialized).not.toContain("fake-token");
    expect(Object.keys(registry.list()[0])).toEqual([
      "key",
      "username",
      "enabled",
    ]);
  });

  it("fails startup on a listed key without a token", () => {
    const env = { ...TWO_BOTS } as Record<string, string | undefined>;
    delete env.PROMPT_POCKET_BOT_BETH_TOKEN;

    expect(() => loadBotRegistry(env)).toThrow(BotRegistryConfigError);
    expect(() => loadBotRegistry(env)).toThrow(/PROMPT_POCKET_BOT_BETH_TOKEN/);
  });

  it("fails startup on a listed key with an empty token", () => {
    const env = { ...TWO_BOTS, PROMPT_POCKET_BOT_BETH_TOKEN: "   " };

    expect(() => loadBotRegistry(env)).toThrow(BotRegistryConfigError);
  });

  it("fails startup on a malformed key in the list", () => {
    expect(() =>
      loadBotRegistry({
        PROMPT_POCKET_BOTS: "Hermes1",
        PROMPT_POCKET_BOT_HERMES1_TOKEN: "x",
      }),
    ).toThrow(BotRegistryConfigError);
    expect(() =>
      loadBotRegistry({
        PROMPT_POCKET_BOTS: "a",
        PROMPT_POCKET_BOT_A_TOKEN: "x",
      }),
    ).toThrow(BotRegistryConfigError);
  });

  it("fails startup on a duplicated key", () => {
    expect(() =>
      loadBotRegistry({
        PROMPT_POCKET_BOTS: "hermes1,hermes1",
        PROMPT_POCKET_BOT_HERMES1_TOKEN: "x",
      }),
    ).toThrow(BotRegistryConfigError);
  });

  it("maps a hyphenated key to an underscored upper-case env suffix", () => {
    const registry = loadBotRegistry({
      PROMPT_POCKET_BOTS: "taylor-sheridan",
      PROMPT_POCKET_BOT_TAYLOR_SHERIDAN_TOKEN: "fake-token-ts",
    });

    expect(registry.resolve("taylor-sheridan")).toEqual({
      key: "taylor-sheridan",
      username: null,
      token: "fake-token-ts",
    });
  });

  it("treats a key that is not listed as disabled even when its token exists", () => {
    const env = { ...TWO_BOTS, PROMPT_POCKET_BOTS: "hermes1" };
    const registry = loadBotRegistry(env);

    expect(registry.resolve("beth")).toBeUndefined();
    expect(registry.resolve("hermes1")).toBeDefined();
    expect(registry.list().map((entry) => entry.key)).toEqual(["hermes1"]);
  });

  it("resolves nothing for unknown, malformed, or non-string keys", () => {
    const registry = loadBotRegistry(TWO_BOTS);

    expect(registry.resolve("nobody")).toBeUndefined();
    expect(registry.resolve("HERMES1")).toBeUndefined();
    expect(registry.resolve("hermes1 ")).toBeUndefined();
    expect(registry.resolve(42)).toBeUndefined();
    expect(registry.resolve(undefined)).toBeUndefined();
    expect(registry.resolve("__proto__")).toBeUndefined();
  });

  it("does not use TELEGRAM_BOT_TOKEN as a fallback for any key", () => {
    const registry = loadBotRegistry({
      PROMPT_POCKET_BOTS: "",
      TELEGRAM_BOT_TOKEN: "v1-only-token",
    });

    expect(registry.list()).toEqual([]);
    expect(registry.resolve("hermes1")).toBeUndefined();
  });

  it("tolerates whitespace and trailing commas in the list", () => {
    const registry = loadBotRegistry({
      ...TWO_BOTS,
      PROMPT_POCKET_BOTS: " hermes1 , beth, ",
    });

    expect(registry.list().map((entry) => entry.key)).toEqual([
      "hermes1",
      "beth",
    ]);
  });

  it("reads the global dispatch kill switch when the variable is set to any value", () => {
    expect(
      loadBotRegistry({ ...TWO_BOTS, PROMPT_POCKET_DISPATCH_DISABLED: "1" })
        .dispatchDisabled,
    ).toBe(true);
    expect(
      loadBotRegistry({ ...TWO_BOTS, PROMPT_POCKET_DISPATCH_DISABLED: "0" })
        .dispatchDisabled,
    ).toBe(true);
    expect(loadBotRegistry(TWO_BOTS).dispatchDisabled).toBe(false);
  });

  it("fails startup when two keys share one env suffix (`a_b` and `a-b`)", () => {
    // Both keys upper-case to the same PROMPT_POCKET_BOT_A_B_TOKEN suffix, so
    // they would silently validate with one token. Fail closed at startup.
    const env = {
      PROMPT_POCKET_BOTS: "a_b,a-b",
      PROMPT_POCKET_BOT_A_B_TOKEN: "fake-token-shared",
    };
    expect(() => loadBotRegistry(env)).toThrow(BotRegistryConfigError);
    expect(() => loadBotRegistry(env)).toThrow(/a_b/);
    expect(() => loadBotRegistry(env)).toThrow(/a-b/);
  });

  it("accepts keys whose env suffixes are genuinely distinct", () => {
    const registry = loadBotRegistry({
      PROMPT_POCKET_BOTS: "a_b,ab",
      PROMPT_POCKET_BOT_A_B_TOKEN: "fake-token-underscore",
      PROMPT_POCKET_BOT_AB_TOKEN: "fake-token-plain",
    });
    expect(registry.resolve("a_b")?.token).toBe("fake-token-underscore");
    expect(registry.resolve("ab")?.token).toBe("fake-token-plain");
  });
});
