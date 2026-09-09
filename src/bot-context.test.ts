import { afterEach, describe, expect, it } from "vitest";
import { parseBotContext, readBotContext } from "./bot-context";

describe("parseBotContext", () => {
  it("accepts a key that matches the registry grammar", () => {
    expect(parseBotContext("?bot=hermes1")).toEqual({ botKey: "hermes1" });
    expect(parseBotContext("?bot=beth")).toEqual({ botKey: "beth" });
    expect(parseBotContext("?x=1&bot=my-bot_2")).toEqual({
      botKey: "my-bot_2",
    });
  });

  it("reports missing when there is no bot param at all", () => {
    expect(parseBotContext("")).toEqual({ botKey: null, reason: "missing" });
    expect(parseBotContext("?other=1")).toEqual({
      botKey: null,
      reason: "missing",
    });
  });

  it.each([
    ["empty value", "?bot="],
    ["single char", "?bot=a"],
    ["uppercase (no normalization)", "?bot=HERMES1"],
    ["leading digit", "?bot=1hermes"],
    ["path traversal", "?bot=../admin"],
    ["url-encoded space", "?bot=hermes1%20"],
    ["too long", `?bot=${"a".repeat(33)}`],
    ["slash", "?bot=hermes1/beth"],
    ["duplicate params", "?bot=hermes1&bot=beth"],
  ])("rejects %s as malformed", (_label, search) => {
    expect(parseBotContext(search)).toEqual({
      botKey: null,
      reason: "malformed",
    });
  });

  it("carries the key string only, never anything it could route with", () => {
    const parsed = parseBotContext("?bot=hermes1");
    expect(Object.keys(parsed)).toEqual(["botKey"]);
  });
});

describe("readBotContext", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("reads from window.location by default", () => {
    window.history.replaceState({}, "", "/?bot=beth");
    expect(readBotContext()).toEqual({ botKey: "beth" });
  });

  it("accepts an explicit location-like object", () => {
    expect(readBotContext({ search: "?bot=hermes1" })).toEqual({
      botKey: "hermes1",
    });
  });
});
