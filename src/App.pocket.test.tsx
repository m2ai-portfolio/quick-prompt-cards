import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POCKET_LIMITS,
  POCKET_ROUTES,
  type LocalRecord,
  type PromptRecord,
} from "../shared/pocket-contract";
import App from "./App";
import { migrationKeyFor, pocketCacheKeyFor } from "./pocket-sync";
import { createPromptCard } from "./prompts";
import { resetPromptDispatchStateForTests } from "./telegram-actions";
import type { PromptCard } from "./types";

/**
 * App-level wiring for contracts/shared-pocket-v1.md ("Client behavior")
 * and the client side of contracts/prompt-run-v2.md, against an in-memory
 * fake of the v2 routes. HTTP details (headers, timeouts, shapes) are
 * covered in pocket-client.test.ts; this file checks what the user sees.
 */

const API_BASE = "https://api.example.test/prompt-pocket";
const INIT_DATA = "auth_date=1&hash=abc&query_id=q1&user=%7B%22id%22%3A4242%7D";
const PINNED_KEY = "prompt-pocket-pinned-prompts";
const CHANGES_KEY = "prompt-pocket-card-changes";

const promptCard: PromptCard = {
  id: "prompt-example",
  kind: "prompt",
  title: "Prompt example",
  description: "A prompt card",
  category: "Writing",
  tags: [],
  prompt: "A complete, ready-to-run prompt.",
  action: {
    type: "prompt-delivery",
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

type Call = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakeServer() {
  const records: PromptRecord[] = [];
  const calls: Call[] = [];
  let n = 0;
  const failures = {
    /** "unreachable" throws like a network error; an object is a server answer. */
    session: null as "unreachable" | { status: number; body: unknown } | null,
    /** When set, the session answer waits for this promise (boot window). */
    sessionGate: null as Promise<void> | null,
    create: 0,
    import: false,
    promptRun: null as { status: number; body: unknown } | null,
  };

  const mint = (
    input: Omit<PromptRecord, "id" | "revision" | "createdAt" | "updatedAt">,
  ) => {
    const record: PromptRecord = {
      ...input,
      id: `srv-${++n}`,
      revision: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    records.push(record);
    return record;
  };

  const dedupe = (local: LocalRecord) =>
    records.find((r) =>
      local.source === "canonical-override"
        ? r.source === "canonical-override" &&
          r.canonicalCardId === local.canonicalCardId
        : r.source === "personal" &&
          r.title === local.title &&
          r.prompt === local.prompt,
    );

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const path = pathname.replace(/^\/prompt-pocket/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body, headers });

    if (method === "POST" && path === POCKET_ROUTES.session) {
      if (failures.sessionGate) await failures.sessionGate;
      if (failures.session === "unreachable") {
        throw new TypeError("Failed to fetch");
      }
      if (failures.session) {
        return json(failures.session.status, failures.session.body);
      }
      return json(200, {
        sessionToken: "fake-session",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    if (method === "POST" && path === POCKET_ROUTES.promptRunV1) {
      return json(200, { status: "posted" });
    }
    if (method === "POST" && path === POCKET_ROUTES.promptRunV2) {
      const response = failures.promptRun ?? {
        status: 200,
        body: { status: "posted" },
      };
      failures.promptRun = null;
      return json(response.status, response.body);
    }
    if (headers.authorization !== "Bearer fake-session") {
      return json(401, { status: "rejected", error: "session_invalid" });
    }
    if (method === "GET" && path === POCKET_ROUTES.pocket) {
      return json(200, { records: [...records], limits: POCKET_LIMITS });
    }
    if (method === "POST" && path === POCKET_ROUTES.records) {
      if (failures.create > 0) {
        failures.create -= 1;
        return json(500, { status: "error" });
      }
      const existing =
        body.source === "canonical-override"
          ? records.find((r) => r.canonicalCardId === body.canonicalCardId)
          : undefined;
      const record =
        existing ??
        mint({
          source: body.source,
          canonicalCardId: body.canonicalCardId ?? null,
          title: body.title,
          category: body.category,
          prompt: body.prompt,
          hidden: body.hidden ?? false,
        });
      return json(201, { record });
    }
    const recordMatch = path.match(/^\/api\/v2\/pocket\/records\/([^/]+)$/);
    if (recordMatch && method === "PATCH") {
      const record = records.find(
        (r) => r.id === decodeURIComponent(recordMatch[1]),
      );
      if (!record) return json(404, { status: "rejected", error: "not_found" });
      if (record.revision !== body.revision) {
        return json(409, { status: "revision_conflict", current: record });
      }
      const fields = { ...body };
      delete fields.revision;
      Object.assign(record, fields, { revision: record.revision + 1 });
      return json(200, { record });
    }
    if (recordMatch && method === "DELETE") {
      const index = records.findIndex(
        (r) => r.id === decodeURIComponent(recordMatch[1]),
      );
      if (index === -1)
        return json(404, { status: "rejected", error: "not_found" });
      records.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === POCKET_ROUTES.import) {
      if (failures.import) return json(500, { status: "error" });
      const imported: string[] = [];
      const skipped: string[] = [];
      const mapping: Record<string, string> = {};
      const created: PromptRecord[] = [];
      for (const local of body.records as LocalRecord[]) {
        const existing = dedupe(local);
        if (existing) {
          skipped.push(local.localId);
          mapping[local.localId] = existing.id;
          continue;
        }
        const record = mint({
          source: local.source,
          canonicalCardId: local.canonicalCardId ?? null,
          title: local.title,
          category: local.category,
          prompt: local.prompt,
          hidden: local.hidden ?? false,
        });
        imported.push(local.localId);
        mapping[local.localId] = record.id;
        created.push(record);
      }
      return json(200, { imported, skipped, mapping, records: created });
    }
    return json(404, { status: "rejected", error: "not_found" });
  });

  return { fetchMock, records, calls, failures, mint };
}

type FakeServer = ReturnType<typeof createFakeServer>;

const V1_ENDPOINT = `${API_BASE}${POCKET_ROUTES.promptRunV1}`;

/**
 * `botKey === null` launches with no `?bot=` at all (the legacy Menu Button
 * URL). The v1 endpoint is configured in every launch so a test can prove
 * which contract a GO used, or that neither was.
 */
function launchInTelegram(
  server: FakeServer,
  botKey: string | null = "hermes1",
) {
  window.history.replaceState(
    {},
    "",
    botKey === null ? "/" : `/?bot=${botKey}`,
  );
  vi.stubEnv("VITE_PROMPT_POCKET_API_BASE", API_BASE);
  vi.stubEnv("VITE_PROMPT_RUN_ENDPOINT", V1_ENDPOINT);
  vi.stubGlobal("fetch", server.fetchMock);
  window.Telegram = {
    WebApp: {
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      initData: INIT_DATA,
      initDataUnsafe: { query_id: "q1", user: { id: 4242, first_name: "T" } },
    },
  };
}

const promptRunCalls = (server: FakeServer) =>
  server.calls.filter((c) => c.path === POCKET_ROUTES.promptRunV2);
const v1Calls = (server: FakeServer) =>
  server.calls.filter((c) => c.path === POCKET_ROUTES.promptRunV1);

async function pinViaComposer(
  user: ReturnType<typeof userEvent.setup>,
  goal: string,
) {
  await user.click(screen.getByRole("button", { name: "Create a prompt" }));
  await user.type(
    screen.getByLabelText("What should this prompt help you do?"),
    goal,
  );
  await user.click(screen.getByRole("button", { name: "Create my prompt" }));
  await user.click(screen.getByRole("button", { name: "Pin this prompt" }));
}

beforeEach(() => {
  localStorage.clear();
  resetPromptDispatchStateForTests();
});

afterEach(() => {
  delete window.Telegram;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  resetPromptDispatchStateForTests();
});

describe("local-only mode", () => {
  it("labels a plain-browser launch as not synced and keeps today's behavior", () => {
    render(<App cards={[promptCard]} />);
    expect(
      screen.getByText("Not synced: open from the bot's Prompt Pocket menu"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Created prompts stay on this device/),
    ).toBeInTheDocument();
  });

  it("labels a malformed ?bot= inside Telegram as not synced and never calls the server", async () => {
    const server = createFakeServer();
    launchInTelegram(server, "HERMES1");
    render(<App cards={[promptCard]} />);
    expect(
      screen.getByText("Not synced: open from the bot's Prompt Pocket menu"),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to local-only with an honest label when the server cannot be reached, and offers a retry", async () => {
    const server = createFakeServer();
    // Review F4: only a transport failure is "couldn't reach the server";
    // a 400 answer is a rejection and gets its own label (see below).
    server.failures.session = "unreachable";
    launchInTelegram(server);
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify([{ id: "pinned-local", title: "Local pin", prompt: "p" }]),
    );

    render(<App cards={[promptCard]} />);
    expect(
      await screen.findByText("Not synced: couldn't reach the server"),
    ).toBeInTheDocument();
    expect(screen.getByText("Local pin")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const user = userEvent.setup();
    server.failures.session = null;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        screen.getByText(/Your pocket syncs with this bot/),
      ).toBeInTheDocument(),
    );
  });

  it.each([
    [
      { status: 400, body: { status: "rejected", error: "unknown_bot" } },
      "Not synced: this bot isn't enabled for Prompt Pocket",
    ],
    [
      { status: 400, body: { status: "rejected", error: "invalid_init_data" } },
      "Not synced: this launch couldn't be verified. Open Prompt Pocket from the bot's Prompt Pocket menu",
    ],
    [
      { status: 404, body: { status: "not_found" } },
      "Not synced: pocket sync isn't available right now",
    ],
  ])(
    "labels a server rejection at session mint honestly (%j) with no retry that cannot succeed",
    async (answer, label) => {
      const server = createFakeServer();
      server.failures.session = answer;
      launchInTelegram(server, "beth");

      render(<App cards={[promptCard]} />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Try again" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/couldn't reach/)).not.toBeInTheDocument();
    },
  );

  it("keeps the retry for a rate-limited session mint, the one rejection a wait can cure", async () => {
    const server = createFakeServer();
    server.failures.session = {
      status: 429,
      body: { status: "rejected", error: "rate_limited" },
    };
    launchInTelegram(server, "beth");

    render(<App cards={[promptCard]} />);
    expect(
      await screen.findByText(
        "Not synced: too many requests, wait a few minutes",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("launch routing (contracts/prompt-run-v2.md, Client launch URL)", () => {
  it.each([null, "hermes1"])(
    "never sends canonical text for a locally edited card on launch %s",
    async (botKey) => {
      const server = createFakeServer();
      server.failures.session = "unreachable";
      launchInTelegram(server, botKey);
      localStorage.setItem(
        CHANGES_KEY,
        JSON.stringify({
          edits: {
            [promptCard.id]: {
              id: promptCard.id,
              title: "My edited prompt",
              category: "Writing",
              description: "Edited",
              prompt: "Use only my newly edited words.",
            },
          },
          deletedIds: [],
        }),
      );
      const user = userEvent.setup();
      render(<App cards={[promptCard]} />);
      const go = await screen.findByRole("button", {
        name: "Run prompt: My edited prompt",
      });
      await user.click(go);
      expect(
        await screen.findByText("Couldn't send: this prompt isn't synced yet"),
      ).toBeInTheDocument();
      expect(v1Calls(server)).toHaveLength(0);
      expect(promptRunCalls(server)).toHaveLength(0);
    },
  );
  it("a malformed ?bot= inside Telegram never dispatches: GO is a structural refusal, no request on either contract", async () => {
    // Review F2. "A missing or malformed key means no dispatch": a malformed
    // key is a tampered or mistyped URL, so neither v2 nor the v1 rollback
    // route may be used, and the copy must not say "reopen" (reopening the
    // same URL changes nothing).
    const server = createFakeServer();
    launchInTelegram(server, "HERMES1");
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(
      await screen.findByText(
        "Couldn't send: open Prompt Pocket from the bot's Prompt Pocket menu",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reopen Prompt Pocket/)).not.toBeInTheDocument();
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it("no ?bot= at all (the legacy Menu Button URL) still dispatches a starter card through v1, the rollback path", async () => {
    // Decision recorded here and in README: shared-pocket-v1.md's "local-only
    // mode exactly as today" wins for a MISSING key because today's Menu
    // Button URL has no key and v1 validates with that bot's own token.
    // prompt-run-v2.md's "no dispatch" wins for a MALFORMED key (above).
    const server = createFakeServer();
    launchInTelegram(server, null);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    expect(
      screen.getByText("Not synced: open from the bot's Prompt Pocket menu"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(v1Calls(server)).toHaveLength(1);
    expect(v1Calls(server)[0].body).toEqual({
      cardId: "prompt-example",
      initData: INIT_DATA,
    });
    expect(promptRunCalls(server)).toHaveLength(0);
  });

  it("a valid ?bot= whose session was refused still sends a starter card through v2 (no session needed), never v1", async () => {
    // Review F3. v1 would validate this launch with TELEGRAM_BOT_TOKEN, a
    // guaranteed invalid_init_data for the other bot that burns the
    // query_id. v2 catalog dispatch carries only initData + botKey.
    const server = createFakeServer();
    server.failures.session = "unreachable";
    launchInTelegram(server, "beth");
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText("Not synced: couldn't reach the server");
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(v1Calls(server)).toHaveLength(0);
    expect(promptRunCalls(server)[0].body).toEqual({
      botKey: "beth",
      initData: INIT_DATA,
      target: { kind: "catalog", cardId: "prompt-example" },
    });
  });
});

describe("boot window (no cache, session in flight)", () => {
  function gatedLaunch(botKey = "beth") {
    const server = createFakeServer();
    let release: () => void = () => {};
    server.failures.sessionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    launchInTelegram(server, botKey);
    return { server, release };
  }

  it("is labeled, renders no local pins, and a pin made during boot lands on the server, never in the local store", async () => {
    // Review F1 (ADV-1). Before the fix this window was an unlabeled
    // local-only mode: the pin went to the pre-Phase-2 store and vanished
    // when pocket mode landed, with no import offered because the flag was
    // already "done".
    const { server, release } = gatedLaunch();
    localStorage.setItem(migrationKeyFor("4242"), "done");
    const user = userEvent.setup();

    render(<App cards={[promptCard, createPromptCard]} />);
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === POCKET_ROUTES.session)).toBe(
        true,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Syncing your pocket…",
    );
    expect(screen.queryByText(/Not synced/)).not.toBeInTheDocument();

    await pinViaComposer(user, "Boot window pin");
    expect(JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]")).toEqual([]);
    expect(screen.queryByText("Boot window pin")).not.toBeInTheDocument();

    release();
    await waitFor(() => expect(server.records).toHaveLength(1));
    // The optimistic draft node is replaced by the acknowledged record.
    await waitFor(() =>
      expect(screen.getByText("Boot window pin")).toBeInTheDocument(),
    );
    expect(server.records[0]).toMatchObject({
      source: "personal",
      title: "Boot window pin",
    });
    expect(JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]")).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("GO during boot waits for the pocket, then sends through v2 with the user's override, never v1", async () => {
    const { server, release } = gatedLaunch();
    server.mint({
      source: "canonical-override",
      canonicalCardId: promptCard.id,
      title: "My words",
      category: "Writing",
      prompt: "override text",
      hidden: false,
    });
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText("Syncing your pocket…");
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(v1Calls(server)).toHaveLength(0);
    expect(promptRunCalls(server)).toHaveLength(0);

    release();
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(v1Calls(server)).toHaveLength(0);
    expect(promptRunCalls(server)[0].body).toMatchObject({
      target: { kind: "record", recordId: "srv-1" },
    });
  });

  it("an edit saved during boot becomes a server override, not a local card change", async () => {
    const { server, release } = gatedLaunch();
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText("Syncing your pocket…");
    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );
    await user.clear(screen.getByLabelText("Prompt"));
    await user.type(screen.getByLabelText("Prompt"), "Edited during boot.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(localStorage.getItem(CHANGES_KEY)).toBe(
      JSON.stringify({ edits: {}, deletedIds: [] }),
    );

    release();
    await waitFor(() => expect(server.records).toHaveLength(1));
    expect(server.records[0]).toMatchObject({
      source: "canonical-override",
      canonicalCardId: "prompt-example",
      prompt: "Edited during boot.",
    });
    expect(localStorage.getItem(CHANGES_KEY)).toBe(
      JSON.stringify({ edits: {}, deletedIds: [] }),
    );
  });
});

describe("synced pocket", () => {
  it("mints a session with the bot key and raw initData, then renders from server state", async () => {
    const server = createFakeServer();
    server.mint({
      source: "personal",
      canonicalCardId: null,
      title: "Server pin",
      category: "Pinned",
      prompt: "from the server",
      hidden: false,
    });
    server.mint({
      source: "canonical-override",
      canonicalCardId: promptCard.id,
      title: "Renamed elsewhere",
      category: "Business",
      prompt: "override words",
      hidden: false,
    });
    launchInTelegram(server, "beth");

    render(<App cards={[promptCard]} />);

    expect(
      await screen.findByRole("heading", { name: "Pinned prompts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Server pin")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run prompt: Renamed elsewhere" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not synced/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const session = server.calls.find((c) => c.path === POCKET_ROUTES.session)!;
    expect(session.body).toEqual({ botKey: "beth", initData: INIT_DATA });
    expect(session.headers["x-bot-key"]).toBe("beth");
    const list = server.calls.find((c) => c.path === POCKET_ROUTES.pocket)!;
    expect(list.headers.authorization).toBe("Bearer fake-session");
    expect(
      JSON.parse(localStorage.getItem(pocketCacheKeyFor("4242"))!).records,
    ).toHaveLength(2);
  });

  it("pins a prompt server-first, then GO sends prompt-run/v2 with the record target", async () => {
    const server = createFakeServer();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard, createPromptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await pinViaComposer(user, "Turn meeting notes into action items");

    await waitFor(() => expect(server.records).toHaveLength(1));
    expect(server.records[0]).toMatchObject({
      source: "personal",
      title: "Turn meeting notes into action items",
      category: "Pinned",
    });
    // The pre-Phase-2 local store is never written in pocket mode.
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual([]);
    await waitFor(() =>
      expect(screen.queryByText("Syncing…")).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Run prompt: Turn meeting notes into action items",
      }),
    );
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();

    const [run] = promptRunCalls(server);
    expect(run.body).toEqual({
      botKey: "hermes1",
      initData: INIT_DATA,
      target: { kind: "record", recordId: "srv-1" },
    });
    expect(run.headers.authorization).toBeUndefined();
  });

  it("GO on an unedited starter card sends the catalog target", async () => {
    const server = createFakeServer();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(promptRunCalls(server)[0].body).toMatchObject({
      target: { kind: "catalog", cardId: "prompt-example" },
    });
  });

  it("editing a starter card creates a canonical override, and GO then sends that record", async () => {
    const server = createFakeServer();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );
    await user.clear(screen.getByLabelText("Card name"));
    await user.type(
      screen.getByLabelText("Card name"),
      "Follow up with a lead",
    );
    await user.clear(screen.getByLabelText("Prompt"));
    await user.type(screen.getByLabelText("Prompt"), "My own words.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(server.records).toHaveLength(1));
    expect(server.records[0]).toMatchObject({
      source: "canonical-override",
      canonicalCardId: "prompt-example",
      title: "Follow up with a lead",
      prompt: "My own words.",
    });
    expect(localStorage.getItem(CHANGES_KEY)).toBe(
      JSON.stringify({ edits: {}, deletedIds: [] }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Syncing…")).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: "Run prompt: Follow up with a lead" }),
    );
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(promptRunCalls(server)[0].body).toMatchObject({
      target: { kind: "record", recordId: "srv-1" },
    });
  });

  it("deleting a starter card hides it through a server override", async () => {
    const server = createFakeServer();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await user.click(
      screen.getByRole("button", { name: "Edit Prompt example" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete card" }));
    await user.click(
      screen.getByRole("button", { name: "Yes, delete this card" }),
    );

    await waitFor(() =>
      expect(server.records[0]).toMatchObject({ hidden: true }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Run prompt: Prompt example" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("a failed write keeps the user's text, shows 'Couldn't sync, try again', and syncs on retry", async () => {
    const server = createFakeServer();
    server.failures.create = 1;
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard, createPromptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await pinViaComposer(user, "Draft a status update");

    expect(
      await screen.findByText("Couldn't sync, try again"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft a status update")).toBeInTheDocument();
    expect(server.records).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual([]);

    // GO on the unsynced draft is a structural refusal, not a spent session.
    await user.click(
      screen.getByRole("button", { name: "Run prompt: Draft a status update" }),
    );
    expect(
      await screen.findByText("Couldn't send: this prompt isn't synced yet"),
    ).toBeInTheDocument();
    expect(promptRunCalls(server)).toHaveLength(0);

    await user.click(
      screen.getByRole("button", {
        name: "Retry sync for Draft a status update",
      }),
    );
    await waitFor(() => expect(server.records).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't sync, try again"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Draft a status update")).toBeInTheDocument();
  });

  it("a structural rejection never shows the reopen copy and leaves the session usable", async () => {
    const server = createFakeServer();
    server.failures.promptRun = {
      status: 400,
      body: { status: "rejected", error: "unknown_bot" },
    };
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    const go = screen.getByRole("button", {
      name: "Run prompt: Prompt example",
    });
    await user.click(go);
    expect(
      await screen.findByText(
        "Couldn't send: this bot isn't enabled for Prompt Pocket",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reopen Prompt Pocket/)).not.toBeInTheDocument();

    await waitFor(() => expect(go).toBeEnabled());
    await user.click(go);
    expect(await screen.findByText("Sent to Telegram")).toBeInTheDocument();
    expect(promptRunCalls(server)).toHaveLength(2);
  });

  it("a telegram_error shows the reopen copy because the query_id is spent", async () => {
    const server = createFakeServer();
    server.failures.promptRun = {
      status: 502,
      body: { status: "telegram_error" },
    };
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);

    await user.click(
      screen.getByRole("button", { name: "Run prompt: Prompt example" }),
    );
    expect(
      await screen.findByText(
        "Couldn't send, reopen Prompt Pocket to try again",
      ),
    ).toBeInTheDocument();
  });
});

describe("one-time local import", () => {
  function seedLocalData() {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify([
        { id: "pinned-a", title: "Pin A", prompt: "a" },
        { id: "pinned-b", title: "Pin B", prompt: "b" },
      ]),
    );
    localStorage.setItem(
      CHANGES_KEY,
      JSON.stringify({
        edits: {
          "prompt-example": {
            id: "prompt-example",
            title: "Edited locally",
            category: "Business",
            prompt: "local edit",
          },
        },
        deletedIds: [],
      }),
    );
  }

  it("asks with exact counts, imports on consent, verifies the readback, then clears local data and marks done", async () => {
    const server = createFakeServer();
    seedLocalData();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);

    const dialog = await screen.findByRole("dialog", {
      name: "Move your prompts into your pocket?",
    });
    expect(dialog).toHaveTextContent(
      "This device holds 2 pinned prompts, 1 edited card.",
    );
    expect(server.calls.some((c) => c.path === POCKET_ROUTES.import)).toBe(
      false,
    );

    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const importCall = server.calls.find(
      (c) => c.path === POCKET_ROUTES.import,
    )!;
    expect(
      (importCall.body as { records: LocalRecord[] }).records.map(
        (r) => r.localId,
      ),
    ).toEqual(["pin:pinned-a", "pin:pinned-b", "edit:prompt-example"]);
    // Readback happened after the import.
    const importIndex = server.calls.indexOf(importCall);
    expect(
      server.calls
        .slice(importIndex + 1)
        .some((c) => c.method === "GET" && c.path === POCKET_ROUTES.pocket),
    ).toBe(true);

    expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("done");
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(CHANGES_KEY)!)).toEqual({
      edits: {},
      deletedIds: [],
    });
    expect(screen.getByText("Pin A")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run prompt: Edited locally" }),
    ).toBeInTheDocument();
  });

  it("keeps local data and the flag unset when the import fails, then completes on retry", async () => {
    const server = createFakeServer();
    server.failures.import = true;
    seedLocalData();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Couldn't import/,
    );
    expect(localStorage.getItem(migrationKeyFor("4242"))).toBeNull();
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toHaveLength(2);
    expect(server.records).toHaveLength(0);

    server.failures.import = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("done"),
    );
    expect(server.records).toHaveLength(3);
  });

  it("Skip keeps local data, asks again next launch; Never records dismissed and stops asking", async () => {
    const server = createFakeServer();
    seedLocalData();
    launchInTelegram(server);
    const user = userEvent.setup();

    const first = render(<App cards={[promptCard]} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(migrationKeyFor("4242"))).toBeNull();
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toHaveLength(2);
    first.unmount();

    const second = render(<App cards={[promptCard]} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Never" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("dismissed");
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toHaveLength(2);
    second.unmount();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.calls.some((c) => c.path === POCKET_ROUTES.import)).toBe(
      false,
    );
  });

  it("re-offers the import when local data shows up after a migration was already done", async () => {
    // Review F1 tail / F7. A local-only session on this device (legacy URL,
    // server down) can add pins after the flag is "done"; they must not be
    // invisible forever. Import is idempotent by contract, so asking again
    // is safe.
    const server = createFakeServer();
    localStorage.setItem(migrationKeyFor("4242"), "done");
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify([{ id: "pinned-late", title: "Late pin", prompt: "z" }]),
    );
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    const dialog = await screen.findByRole("dialog", {
      name: "Move your prompts into your pocket?",
    });
    expect(dialog).toHaveTextContent("This device holds 1 pinned prompt.");

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(server.records).toHaveLength(1);
    expect(screen.getByText("Late pin")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual([]);
  });

  it("after Never, the count of local prompts left behind stays visible and Import brings the dialog back", async () => {
    const server = createFakeServer();
    localStorage.setItem(migrationKeyFor("4242"), "dismissed");
    seedLocalData();
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByText(/Your pocket syncs with this bot/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /2 pinned prompts, 1 edited card on this device aren't in your pocket/,
      ),
    ).toBeInTheDocument();
    // Neither of the local pins is rendered as if it were in the pocket.
    expect(screen.queryByText("Pin A")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("dismissed");
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("a duplicate import (all skipped) still counts as done", async () => {
    const server = createFakeServer();
    server.mint({
      source: "personal",
      canonicalCardId: null,
      title: "Pin A",
      category: "Pinned",
      prompt: "a",
      hidden: false,
    });
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify([{ id: "pinned-a", title: "Pin A", prompt: "a" }]),
    );
    launchInTelegram(server);
    const user = userEvent.setup();

    render(<App cards={[promptCard]} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(localStorage.getItem(migrationKeyFor("4242"))).toBe("done"),
    );
    expect(server.records).toHaveLength(1);
    expect(screen.getAllByText("Pin A")).toHaveLength(1);
  });
});
