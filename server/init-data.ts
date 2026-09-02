import { createHmac, timingSafeEqual } from "node:crypto";

export type InitDataValidationError =
  "invalid_init_data" | "stale_init_data" | "missing_query_id";

export type InitDataValidationResult =
  { ok: true; queryId: string } | { ok: false; error: InitDataValidationError };

const MAX_AUTH_AGE_SECONDS = 5 * 60;

/**
 * Implements contracts/prompt-run-v1.md Validation steps 1-3: recompute the
 * data-check-string HMAC, reject stale auth_date, then parse query_id only
 * from this already-validated string (never from initDataUnsafe).
 */
export function validateInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): InitDataValidationResult {
  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, error: "invalid_init_data" };
  }

  const dataCheckEntries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    dataCheckEntries.push(`${key}=${value}`);
  }
  dataCheckEntries.sort();
  const dataCheckString = dataCheckEntries.join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!constantTimeEquals(expectedHash, receivedHash)) {
    return { ok: false, error: "invalid_init_data" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) {
    return { ok: false, error: "invalid_init_data" };
  }
  if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, error: "stale_init_data" };
  }

  const queryId = params.get("query_id");
  if (!queryId) {
    return { ok: false, error: "missing_query_id" };
  }

  return { ok: true, queryId };
}

function constantTimeEquals(expected: string, received: string): boolean {
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");
  if (expectedBuf.length !== receivedBuf.length) {
    // Still run a fixed-cost comparison so a length mismatch does not
    // return faster than a same-length mismatch.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, receivedBuf);
}
