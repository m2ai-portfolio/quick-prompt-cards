import { BOT_KEY_PATTERN } from "../shared/pocket-contract.js";

/** Readback shape: never carries a token. */
export type BotRegistryEntry = {
  key: string;
  username: string | null;
  enabled: true;
};

/** Resolved shape: handed only to the initData validator and Telegram client. */
export type ResolvedBot = {
  key: string;
  username: string | null;
  token: string;
};

export class BotRegistryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotRegistryConfigError";
  }
}

const BOTS_VAR = "PROMPT_POCKET_BOTS";
const DISPATCH_DISABLED_VAR = "PROMPT_POCKET_DISPATCH_DISABLED";

/** `hermes-1` -> `HERMES_1` (contracts/prompt-run-v2.md, "Bot registry"). */
export function envSuffixForKey(key: string): string {
  return key.toUpperCase().replace(/-/g, "_");
}

export function tokenVarForKey(key: string): string {
  return `PROMPT_POCKET_BOT_${envSuffixForKey(key)}_TOKEN`;
}

export function usernameVarForKey(key: string): string {
  return `PROMPT_POCKET_BOT_${envSuffixForKey(key)}_USERNAME`;
}

/**
 * Allowlist of bots that may validate a launch and post a dispatch. Built once
 * at startup from environment variable NAMES; a listed key without a token
 * fails startup (fail closed). Unlisted keys are disabled even if their token
 * variable exists. `TELEGRAM_BOT_TOKEN` (v1) is never consulted here.
 */
export class BotRegistry {
  private readonly bots: Map<string, ResolvedBot>;
  readonly dispatchDisabled: boolean;

  constructor(bots: ResolvedBot[], dispatchDisabled: boolean) {
    this.bots = new Map(bots.map((bot) => [bot.key, bot]));
    this.dispatchDisabled = dispatchDisabled;
  }

  list(): BotRegistryEntry[] {
    return [...this.bots.values()].map((bot) => ({
      key: bot.key,
      username: bot.username,
      enabled: true,
    }));
  }

  resolve(key: unknown): ResolvedBot | undefined {
    if (typeof key !== "string" || !BOT_KEY_PATTERN.test(key)) {
      return undefined;
    }
    return this.bots.get(key);
  }
}

export function loadBotRegistry(
  env: Record<string, string | undefined>,
): BotRegistry {
  const listed = (env[BOTS_VAR] ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  const seen = new Set<string>();
  const seenSuffixes = new Map<string, string>();
  const bots: ResolvedBot[] = [];
  for (const key of listed) {
    if (!BOT_KEY_PATTERN.test(key)) {
      throw new BotRegistryConfigError(
        `${BOTS_VAR} contains a malformed key (expected ${BOT_KEY_PATTERN}).`,
      );
    }
    if (seen.has(key)) {
      throw new BotRegistryConfigError(
        `${BOTS_VAR} lists the key "${key}" more than once.`,
      );
    }
    seen.add(key);

    // `a_b` and `a-b` are distinct keys that share one env suffix (`A_B`), so
    // they would silently validate with the same token. Fail closed instead.
    const suffix = envSuffixForKey(key);
    const collidingKey = seenSuffixes.get(suffix);
    if (collidingKey !== undefined) {
      throw new BotRegistryConfigError(
        `${BOTS_VAR} keys "${collidingKey}" and "${key}" both map to ${tokenVarForKey(key)}.`,
      );
    }
    seenSuffixes.set(suffix, key);

    const tokenVar = tokenVarForKey(key);
    const token = env[tokenVar]?.trim() ?? "";
    if (token.length === 0) {
      throw new BotRegistryConfigError(
        `Bot key "${key}" is listed in ${BOTS_VAR} but ${tokenVar} is not set.`,
      );
    }

    const username = env[usernameVarForKey(key)]?.trim();
    bots.push({
      key,
      username: username && username.length > 0 ? username : null,
      token,
    });
  }

  return new BotRegistry(bots, env[DISPATCH_DISABLED_VAR] !== undefined);
}
