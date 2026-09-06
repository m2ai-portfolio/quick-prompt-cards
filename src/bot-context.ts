import { isValidBotKey } from "../shared/pocket-contract";

/**
 * Why the launch URL's `?bot=` key is refused rather than normalized:
 * contracts/prompt-run-v2.md ("Client launch URL") says the client parses
 * the key strictly against the registry grammar and that a missing or
 * malformed key means local-only mode. The key is a routing hint only. It
 * is copied into the `X-Bot-Key` header and the `botKey` request field and
 * nowhere else: it never selects an endpoint, an origin, or a permission.
 */
export type BotContextReason = "missing" | "malformed";

export type BotContext =
  { botKey: string } | { botKey: null; reason: BotContextReason };

export function parseBotContext(search: string): BotContext {
  const values = new URLSearchParams(search).getAll("bot");
  if (values.length === 0) return { botKey: null, reason: "missing" };
  // Two `bot` params is an ambiguous launch, not a choice to make silently.
  if (values.length > 1) return { botKey: null, reason: "malformed" };
  const [value] = values;
  return isValidBotKey(value)
    ? { botKey: value }
    : { botKey: null, reason: "malformed" };
}

export function readBotContext(
  location: { search: string } = window.location,
): BotContext {
  return parseBotContext(location.search);
}
