import { createHmac } from "node:crypto";

/**
 * Builds a validly-signed initData string for tests, following the same
 * algorithm contracts/prompt-run-v1.md requires the server to verify.
 * Test-only: production code never signs, only verifies.
 */
export function signInitData(
  botToken: string,
  fields: Record<string, string>,
): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}
