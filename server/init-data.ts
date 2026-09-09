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

export type InitDataIdentityResult =
  | { ok: true; userId: number; queryId: string | null }
  | { ok: false; error: InitDataValidationError };

/**
 * contracts/prompt-run-v2.md step 4 and contracts/shared-pocket-v1.md
 * "Session" step 1: same HMAC and freshness checks as v1, plus `user.id`
 * must be present and numeric. `query_id` is required for dispatch and
 * optional for session minting. The v1 `validateInitData` above is left
 * untouched so the frozen v1 route keeps its exact behavior.
 */
export function validateInitDataIdentity(
  initData: string,
  botToken: string,
  nowSeconds: number,
  options: { requireQueryId: boolean },
): InitDataIdentityResult {
  const verified = verifySignatureAndFreshness(initData, botToken, nowSeconds);
  if (!verified.ok) {
    return verified;
  }

  const userId = parseUserId(verified.params.get("user"));
  if (userId === undefined) {
    return { ok: false, error: "invalid_init_data" };
  }

  const queryId = verified.params.get("query_id");
  if (options.requireQueryId && !queryId) {
    return { ok: false, error: "missing_query_id" };
  }

  return { ok: true, userId, queryId: queryId || null };
}

function verifySignatureAndFreshness(
  initData: string,
  botToken: string,
  nowSeconds: number,
):
  | { ok: true; params: URLSearchParams }
  | { ok: false; error: InitDataValidationError } {
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

  return { ok: true, params };
}

function parseUserId(raw: string | null): number | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return undefined;
  }
  return id;
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
