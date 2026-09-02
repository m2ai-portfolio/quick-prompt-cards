// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateInitData } from "./init-data";
import { signInitData } from "./test-helpers/init-data";

const BOT_TOKEN = "test-bot-token-123456";
const NOW = 1_800_000_000;

function baseFields(overrides: Record<string, string> = {}) {
  return {
    query_id: "AAHdF6IQAAAAAAG5A_-eu1td",
    user: '{"id":1,"first_name":"Test"}',
    auth_date: String(NOW),
    ...overrides,
  };
}

describe("validateInitData", () => {
  it("accepts a validly-signed request and returns the parsed query_id", () => {
    const fields = baseFields();
    const initData = signInitData(BOT_TOKEN, fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: true, queryId: fields.query_id });
  });

  it("rejects a forged hash", () => {
    const fields = baseFields();
    const initData = signInitData(BOT_TOKEN, fields);
    const tampered = initData.replace(
      `query_id=${encodeURIComponent(fields.query_id)}`,
      `query_id=${encodeURIComponent("attacker-supplied-id")}`,
    );

    const result = validateInitData(tampered, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "invalid_init_data" });
  });

  it("rejects a hash signed with the wrong bot token", () => {
    const fields = baseFields();
    const initData = signInitData("a-different-bot-token", fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "invalid_init_data" });
  });

  it("rejects a missing hash field", () => {
    const params = new URLSearchParams(baseFields());

    const result = validateInitData(params.toString(), BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "invalid_init_data" });
  });

  it("rejects auth_date older than 5 minutes", () => {
    const staleAuthDate = NOW - 5 * 60 - 1;
    const fields = baseFields({ auth_date: String(staleAuthDate) });
    const initData = signInitData(BOT_TOKEN, fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "stale_init_data" });
  });

  it("accepts auth_date exactly at the 5 minute boundary", () => {
    const boundaryAuthDate = NOW - 5 * 60;
    const fields = baseFields({ auth_date: String(boundaryAuthDate) });
    const initData = signInitData(BOT_TOKEN, fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result.ok).toBe(true);
  });

  it("rejects a request missing query_id after signature and auth_date pass", () => {
    const fields = {
      user: '{"id":1,"first_name":"Test"}',
      auth_date: String(NOW),
    };
    const initData = signInitData(BOT_TOKEN, fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "missing_query_id" });
  });

  it("rejects a non-numeric auth_date as invalid rather than crashing", () => {
    const fields = baseFields({ auth_date: "not-a-number" });
    const initData = signInitData(BOT_TOKEN, fields);

    const result = validateInitData(initData, BOT_TOKEN, NOW);

    expect(result).toEqual({ ok: false, error: "invalid_init_data" });
  });
});
