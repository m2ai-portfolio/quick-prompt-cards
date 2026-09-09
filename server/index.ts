import { POCKET_LIMITS } from "../shared/pocket-contract.js";
import { loadBotRegistry } from "./bot-registry.js";
import { createAppServer, type RequestLogLine } from "./http-server.js";
import { PocketStore } from "./pocket-store.js";
import { SessionService, startSessionSweep } from "./session.js";

const HOUR_MS = 60 * 60 * 1000;

// v1 (frozen): TELEGRAM_BOT_TOKEN serves only POST /api/prompt-run and is
// never a fallback for any v2 request.
const v1BotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;

// v2: enabled when PROMPT_POCKET_BOTS names at least one key. Misconfiguration
// (listed key without a token, malformed key, missing data dir) fails here,
// at startup, never on the first request.
const botsConfigured = (process.env.PROMPT_POCKET_BOTS ?? "").trim().length > 0;
const registry = botsConfigured ? loadBotRegistry(process.env) : undefined;

let store: PocketStore | undefined;
let sessions: SessionService | undefined;
if (registry) {
  const dataDir = process.env.PROMPT_POCKET_DATA_DIR?.trim();
  if (!dataDir) {
    throw new Error(
      "PROMPT_POCKET_DATA_DIR is required when PROMPT_POCKET_BOTS is set.",
    );
  }
  store = PocketStore.open(dataDir);
  sessions = new SessionService(store);
}

if (!v1BotToken && !registry) {
  throw new Error(
    "Nothing to serve: set TELEGRAM_BOT_TOKEN (v1 route) and/or PROMPT_POCKET_BOTS (v2 routes).",
  );
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim() || undefined;

const log = (line: RequestLogLine) => {
  console.log(JSON.stringify(line));
};

const server = createAppServer({
  v1BotToken,
  allowedOrigin,
  pocket:
    registry && store && sessions ? { registry, store, sessions } : undefined,
  log,
});

if (store && sessions) {
  startSessionSweep(sessions, HOUR_MS);
  const purgeTimer = setInterval(() => {
    try {
      store?.purgeSoftDeleted(
        POCKET_LIMITS.softDeleteRetentionDays,
        new Date().toISOString(),
      );
    } catch {
      // Retried on the next tick.
    }
  }, HOUR_MS);
  purgeTimer.unref();
}

server.listen(port, () => {
  const bots = registry
    ? registry
        .list()
        .map((bot) => bot.key)
        .join(",")
    : "";
  console.log(
    JSON.stringify({
      event: "listening",
      port,
      v1Route: Boolean(v1BotToken),
      bots,
      dispatchDisabled: registry?.dispatchDisabled ?? false,
    }),
  );
});

function shutdown(): void {
  server.close(() => {
    store?.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
