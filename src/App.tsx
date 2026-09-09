import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pencil, PinOff, RefreshCw, Search, X } from "lucide-react";
import m2aiMarkUrl from "./assets/m2ai-mark.webp";
import type { DispatchTarget } from "../shared/pocket-contract";
import { filterPrompts } from "./prompt-utils";
import { categories, prompts } from "./prompts";
import {
  copyPromptToClipboard,
  isTelegramWebAppSupported,
  isTelegramWebAppSupportedV2,
  runPrompt as dispatchPrompt,
  sendWebAppQuery,
  sendWebAppQueryV2,
  type DispatchRejectReason,
  type RunPromptResult,
  type RunnablePrompt,
} from "./telegram-actions";
import type { Card, PromptCard } from "./types";
import PromptCreator from "./components/PromptCreator";
import PromptCardEditor from "./components/PromptCardEditor";
import LocalPocketMigration from "./components/LocalPocketMigration";
import { parsePinnedPrompts, type PinnedPrompt } from "./prompt-creator";
import {
  EMPTY_PROMPT_CARD_CHANGES,
  parsePromptCardChanges,
  type PromptCardChanges,
  type PromptCardEdit,
} from "./card-customizations";
import WorkflowWizard from "./components/WorkflowWizard";
import { createAutomationStorage } from "./workflows/wizard-state";
import type { WorkflowDefinition } from "./workflows/types";
import { readBotContext } from "./bot-context";
import { getPocketApiBase } from "./pocket-client";
import {
  applyPocketOverrides,
  createPocketSync,
  findOverride,
  isRetryableFailure,
  recordsOfSource,
  selectPocketView,
  type MigrationStatus,
  type PocketSync,
  type PocketSyncState,
  type PocketViewRecord,
} from "./pocket-sync";
import { usePocketSyncState } from "./use-pocket-sync";
import {
  PINNED_CATEGORY,
  countLocalPocket,
  describeLocalPocket,
  importLocalPocket,
  planLocalImport,
  totalLocalPocket,
} from "./local-migration";

const PINNED_PROMPTS_KEY = "prompt-pocket-pinned-prompts";
const PROMPT_CARD_CHANGES_KEY = "prompt-pocket-card-changes";

type RunStatus = { status: "pending" } | { status: "error" } | RunPromptResult;

/**
 * "Reopen Prompt Pocket" appears ONLY for `unavailable`: the session's
 * single-use query_id is spent, or this launch never had one, so a fresh
 * Menu Button launch is the actual remedy (contracts/prompt-run-v2.md,
 * "Idempotency, single-use, retry, fallback"). Structural rejections get
 * their own honest copy because reopening would change nothing.
 */
const REJECT_LABEL: Record<DispatchRejectReason, string> = {
  unknown_bot: "Couldn't send: this bot isn't enabled for Prompt Pocket",
  dispatch_disabled: "Couldn't send: sending is paused right now",
  invalid_request: "Couldn't send from this launch",
  invalid_init_data: "Couldn't send from this launch",
  unknown_target: "Couldn't send: this prompt isn't in your pocket anymore",
  rate_limited: "Too many sends. Wait a few minutes, then reopen Prompt Pocket",
  not_synced: "Couldn't send: this prompt isn't synced yet",
  invalid_bot_key:
    "Couldn't send: open Prompt Pocket from the bot's Prompt Pocket menu",
  no_pocket_server: "Couldn't send: this build has no pocket server",
};

/**
 * Which dispatch contract this launch may use, decided once from the launch
 * URL (contracts/prompt-run-v2.md, "Client launch URL"):
 * - a valid `?bot=` key: prompt-run/v2. A catalog dispatch needs no session,
 *   so this holds even when the pocket session failed; v1 would validate
 *   with the wrong bot's token and burn the query_id.
 * - no key at all: the legacy Menu Button URL, prompt-run/v1 with the v1
 *   bot. This is the rollback path and stays until Matt retires v1.
 * - a malformed key: no dispatch. The URL was tampered with or mistyped;
 *   reopening changes nothing, so the refusal is structural, never "reopen".
 */
type DispatchRoute =
  | { kind: "v2" }
  | { kind: "v1" }
  | { kind: "refused"; reason: DispatchRejectReason };

function chooseDispatchRoute(
  botContext: ReturnType<typeof readBotContext>,
  apiBase: string | undefined,
): DispatchRoute {
  if (botContext.botKey === null) {
    return botContext.reason === "missing"
      ? { kind: "v1" }
      : { kind: "refused", reason: "invalid_bot_key" };
  }
  return apiBase
    ? { kind: "v2" }
    : { kind: "refused", reason: "no_pocket_server" };
}

/**
 * Honest tail for a server rejection at sync time. None of these is cured
 * by "Try again" except a rate limit, so the banner offers no retry for
 * the rest (contracts/shared-pocket-v1.md asks for an honest label).
 */
function describeSyncRejection(code: string | null | undefined): string {
  switch (code) {
    case "unknown_bot":
      return "this bot isn't enabled for Prompt Pocket";
    case "invalid_init_data":
    case "stale_init_data":
    case "invalid_request":
      return "this launch couldn't be verified. Open Prompt Pocket from the bot's Prompt Pocket menu";
    case "rate_limited":
      return "too many requests, wait a few minutes";
    case "not_found":
      return "pocket sync isn't available right now";
    default:
      return "the server declined this launch";
  }
}

function statusLabel(entry: RunStatus): string {
  switch (entry.status) {
    case "pending":
      return "Sending…";
    case "dispatched":
      return "Sent to Telegram";
    case "fallback-copied":
      return "Copied to clipboard";
    case "unavailable":
      return "Couldn't send, reopen Prompt Pocket to try again";
    case "error":
      return "Couldn't send, try again";
    case "rejected":
      return REJECT_LABEL[entry.reason];
  }
}

const NOT_SYNCED_LABEL = "Not synced: open from the bot's Prompt Pocket menu";
const UNREACHABLE_LABEL = "Not synced: couldn't reach the server";
const BOOTING_LABEL = "Syncing your pocket…";

type PinnedView = {
  id: string;
  title: string;
  prompt: string;
  unsynced?: PocketViewRecord["unsynced"];
};

type AppProps = {
  cards?: Card[];
  runPrompt?: (cardId: string) => Promise<RunPromptResult>;
  workflows?: Record<string, WorkflowDefinition>;
  /** Injected by tests; production builds one from the launch context. */
  pocketSync?: PocketSync;
};

export default function App({
  cards = prompts,
  runPrompt,
  workflows = {},
  pocketSync,
}: AppProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [isCreatingPrompt, setIsCreatingPrompt] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusResultsAfterDeleteRef = useRef(false);
  const [cardChanges, setCardChanges] = useState<PromptCardChanges>(() => {
    try {
      return parsePromptCardChanges(
        localStorage.getItem(PROMPT_CARD_CHANGES_KEY),
      );
    } catch {
      return EMPTY_PROMPT_CARD_CHANGES;
    }
  });
  const [pinnedPrompts, setPinnedPrompts] = useState<PinnedPrompt[]>(() => {
    try {
      return parsePinnedPrompts(localStorage.getItem(PINNED_PROMPTS_KEY));
    } catch {
      return [];
    }
  });
  // Created once per App mount (a tab session) so its in-memory fallback
  // persists across a workflow wizard closing and reopening in that same
  // tab, instead of resetting with each WorkflowWizard mount. The pocket
  // cache and migration flag share the same adapter.
  const [workflowStorage] = useState(() => createAutomationStorage());
  const [botContext] = useState(() => readBotContext());
  const [pocket] = useState<PocketSync>(
    () =>
      pocketSync ??
      createPocketSync({
        botContext,
        apiBase: getPocketApiBase(),
        telegram: window.Telegram?.WebApp,
        storage: workflowStorage,
      }),
  );
  const pocketState = usePocketSyncState(pocket);
  // "reopened" is a per-mount state: the user asked for the dialog back
  // after a Skip/Never, so it shows once more without touching storage.
  const [migrationStatus, setMigrationStatus] = useState<
    MigrationStatus | "skipped" | "reopened"
  >(() => pocket.getMigrationStatus());

  useEffect(() => {
    void pocket.bootstrap();
  }, [pocket]);

  const pocketMode = pocketState.mode === "pocket";
  // A launch that WILL sync (or is still finding out) never shows or
  // writes the pre-Phase-2 local stores: during boot the catalog renders
  // plain under a "Syncing your pocket…" label, and every write or GO waits
  // for the bootstrap to settle before choosing server or local.
  const booting = pocketState.mode === "booting";
  const pocketRecords = useMemo(
    () => selectPocketView(pocketState),
    [pocketState],
  );

  /**
   * Runs `act` against the settled sync state. Synchronous when the store
   * is already settled (the common case, so local-only behavior is exactly
   * as today); otherwise it waits for the shared in-flight bootstrap. The
   * callback reads the store directly rather than React state, which would
   * be stale inside the continuation.
   */
  const withBootedPocket = (act: (state: PocketSyncState) => void) => {
    if (pocket.getState().mode !== "booting") {
      act(pocket.getState());
      return;
    }
    void pocket.bootstrap().then(() => act(pocket.getState()));
  };

  const settledPocket = async (): Promise<PocketSyncState> => {
    if (pocket.getState().mode === "booting") await pocket.bootstrap();
    return pocket.getState();
  };

  const openWorkflow = (workflowId: string) => {
    if (!workflows[workflowId]) return;
    setActiveWorkflowId(workflowId);
  };

  const closeWorkflow = () => setActiveWorkflowId(null);

  const customizedCards = useMemo(() => {
    if (pocketMode) return applyPocketOverrides(cards, pocketRecords);
    if (booting) return cards;
    const deleted = new Set(cardChanges.deletedIds);
    return cards
      .filter((card) => card.kind !== "prompt" || !deleted.has(card.id))
      .map((card) =>
        card.kind === "prompt" && cardChanges.edits[card.id]
          ? { ...card, ...cardChanges.edits[card.id] }
          : card,
      );
  }, [booting, cardChanges, cards, pocketMode, pocketRecords]);

  const cardsById = useMemo(
    () => new Map(customizedCards.map((card) => [card.id, card])),
    [customizedCards],
  );

  const pinnedView = useMemo<PinnedView[]>(
    () =>
      pocketMode
        ? recordsOfSource(pocketRecords, "personal").map((record) => ({
            id: record.id,
            title: record.title,
            prompt: record.prompt,
            unsynced: record.unsynced,
          }))
        : booting
          ? []
          : pinnedPrompts,
    [booting, pinnedPrompts, pocketMode, pocketRecords],
  );

  const isInTelegramContext = Boolean(window.Telegram?.WebApp);
  const apiBase = getPocketApiBase();
  const dispatchRoute = useMemo(
    () => chooseDispatchRoute(botContext, apiBase),
    [apiBase, botContext],
  );
  const supportsV2 = isTelegramWebAppSupportedV2(apiBase, botContext.botKey);
  const supportsV1 = isTelegramWebAppSupported();
  const supportsOneTapDispatch =
    dispatchRoute.kind === "v2"
      ? supportsV2
      : dispatchRoute.kind === "v1"
        ? supportsV1
        : false;

  /**
   * v2 send through the pocket's client. A null target means the prompt
   * has no server record (a draft whose create failed, an edit still
   * unsynced, or a local pin in local-only mode); that is a structural
   * `not_synced` rejection that must never spend the session's query_id,
   * so it short-circuits before the network.
   */
  const runV2 = (prompt: RunnablePrompt, target: DispatchTarget | null) =>
    dispatchPrompt(prompt, {
      isInTelegram: () => isInTelegramContext,
      supportsOneTapDispatch: () => supportsV2,
      sendWebAppQuery: async () =>
        target
          ? sendWebAppQueryV2(target, (initData, t) =>
              pocket.promptRunV2(initData, t),
            )
          : { status: "rejected", reason: "not_synced" },
      copyToClipboard: copyPromptToClipboard,
    });

  const runV1 = (prompt: RunnablePrompt, dispatchable: boolean) =>
    dispatchPrompt(prompt, {
      isInTelegram: () => isInTelegramContext,
      supportsOneTapDispatch: () => supportsV1,
      // A local pin never exists in the server catalog, so a v1 attempt is
      // guaranteed `unknown_card` and would burn the session's query_id
      // (contracts/prompt-run-v1.md, "Single-use / retry boundary"). It is
      // refused locally instead, leaving the query_id for catalog cards.
      sendWebAppQuery: async (cardId) =>
        dispatchable
          ? sendWebAppQuery(cardId)
          : { status: "rejected", reason: "not_synced" },
      copyToClipboard: copyPromptToClipboard,
    });

  /**
   * A launch whose URL forbids dispatch. Inside Telegram this is a
   * structural rejection (the query_id is never spent); outside Telegram it
   * is the plain-browser clipboard fallback, exactly as today.
   */
  const runRefused = (prompt: RunnablePrompt, reason: DispatchRejectReason) =>
    dispatchPrompt(prompt, {
      isInTelegram: () => isInTelegramContext,
      supportsOneTapDispatch: () => isInTelegramContext,
      sendWebAppQuery: async () => ({ status: "rejected", reason }),
      copyToClipboard: copyPromptToClipboard,
    });

  const defaultRunPrompt = async (cardId: string): Promise<RunPromptResult> => {
    const card = cardsById.get(cardId) as PromptCard;
    if (dispatchRoute.kind === "refused") {
      return runRefused(card, dispatchRoute.reason);
    }
    if (dispatchRoute.kind === "v1") {
      return runV1(card, !cardChanges.edits[cardId]);
    }
    // Wait for the pocket to settle so a starter card the user edited on
    // another device posts their words, not the canonical text. If the
    // pocket never loads, a catalog dispatch still needs no session.
    const state = await settledPocket();
    // A local edit has no server record. Never replace its visible words
    // with the catalog original just because bootstrap failed.
    if (state.mode !== "pocket" && cardChanges.edits[cardId]) {
      return runV2(card, null);
    }
    const override =
      state.mode === "pocket"
        ? findOverride(selectPocketView(state), card.id)
        : undefined;
    // An unedited starter card posts the canonical text; an edited one
    // posts the user's override record (its own words), but only once
    // that override is actually on the server.
    const target: DispatchTarget | null = !override
      ? { kind: "catalog", cardId: card.id }
      : override.unsynced
        ? null
        : { kind: "record", recordId: override.id };
    return runV2(card, target);
  };
  const runPromptAction = runPrompt ?? defaultRunPrompt;

  const runPinnedPrompt = (prompt: PinnedView) => {
    if (dispatchRoute.kind === "refused") {
      return runRefused(prompt, dispatchRoute.reason);
    }
    // Outside pocket mode a pin is local-only: no server record exists, so
    // neither contract can target it and the query_id stays unspent.
    if (!pocketMode) {
      return dispatchRoute.kind === "v1"
        ? runV1(prompt, false)
        : runV2(prompt, null);
    }
    return runV2(
      prompt,
      prompt.unsynced ? null : { kind: "record", recordId: prompt.id },
    );
  };

  useEffect(() => {
    window.Telegram?.WebApp.ready();
    window.Telegram?.WebApp.expand();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_PROMPTS_KEY, JSON.stringify(pinnedPrompts));
    } catch {
      // The current tab still keeps pinned prompts when storage is blocked.
    }
  }, [pinnedPrompts]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PROMPT_CARD_CHANGES_KEY,
        JSON.stringify(cardChanges),
      );
    } catch {
      // The current tab still keeps card changes when storage is blocked.
    }
  }, [cardChanges]);

  const saveCardEdit = (edit: PromptCardEdit) => {
    const fields = {
      title: edit.title,
      category: edit.category,
      prompt: edit.prompt,
    };
    withBootedPocket((state) => {
      if (state.mode === "pocket") {
        const override = findOverride(selectPocketView(state), edit.id);
        if (override?.unsynced) {
          pocket.discardChange(override.unsynced.changeId);
        }
        if (override && override.unsynced?.op !== "create") {
          void pocket.updateRecord(override.id, fields);
        } else {
          void pocket.createRecord({
            source: "canonical-override",
            canonicalCardId: edit.id,
            ...fields,
          });
        }
      } else {
        setCardChanges((current) => ({
          ...current,
          edits: { ...current.edits, [edit.id]: edit },
        }));
      }
    });
    setEditingCardId(null);
  };

  const deleteCard = (id: string) => {
    focusResultsAfterDeleteRef.current = true;
    const card = cardsById.get(id) as PromptCard | undefined;
    withBootedPocket((state) => {
      if (state.mode === "pocket") {
        const override = findOverride(selectPocketView(state), id);
        if (override?.unsynced) {
          pocket.discardChange(override.unsynced.changeId);
        }
        if (override && override.unsynced?.op !== "create") {
          void pocket.updateRecord(override.id, { hidden: true });
        } else if (card) {
          void pocket.createRecord({
            source: "canonical-override",
            canonicalCardId: id,
            title: card.title,
            category: card.category,
            prompt: card.prompt,
            hidden: true,
          });
        }
      } else {
        setCardChanges((current) => ({
          edits: Object.fromEntries(
            Object.entries(current.edits).filter(([cardId]) => cardId !== id),
          ),
          deletedIds: [...new Set([...current.deletedIds, id])],
        }));
      }
    });
    setEditingCardId(null);
  };

  useEffect(() => {
    if (!editingCardId && focusResultsAfterDeleteRef.current) {
      resultsHeadingRef.current?.focus();
      focusResultsAfterDeleteRef.current = false;
    }
  }, [customizedCards.length, editingCardId]);

  const pinPrompt = (prompt: PinnedPrompt) => {
    withBootedPocket((state) => {
      if (state.mode === "pocket") {
        void pocket.createRecord({
          source: "personal",
          title: prompt.title,
          category: PINNED_CATEGORY,
          prompt: prompt.prompt,
        });
      } else {
        setPinnedPrompts((current) => [
          prompt,
          ...current.filter((item) => item.id !== prompt.id),
        ]);
      }
    });
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
  };

  const unpinPrompt = (prompt: PinnedView) => {
    if (pocketMode) {
      if (prompt.unsynced?.op === "create") {
        pocket.discardChange(prompt.unsynced.changeId);
      } else {
        if (prompt.unsynced) pocket.discardChange(prompt.unsynced.changeId);
        void pocket.deleteRecord(prompt.id);
      }
    } else {
      setPinnedPrompts((current) =>
        current.filter((item) => item.id !== prompt.id),
      );
    }
  };

  const visibleCards = useMemo(() => {
    return filterPrompts(customizedCards, query, category);
  }, [customizedCards, category, query]);

  const editingCard = editingCardId
    ? (cardsById.get(editingCardId) as PromptCard | undefined)
    : undefined;

  const clearRunStatus = (id: string) => {
    setRunStatus((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const trackRun = async (id: string, run: () => Promise<RunPromptResult>) => {
    if (runStatus[id]?.status === "pending") return;

    setRunStatus((current) => ({ ...current, [id]: { status: "pending" } }));
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");

    try {
      const result = await run();
      setRunStatus((current) => ({ ...current, [id]: result }));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(
        result.status === "dispatched" ? "success" : "warning",
      );
    } catch {
      setRunStatus((current) => ({ ...current, [id]: { status: "error" } }));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    }

    window.setTimeout(() => clearRunStatus(id), 2600);
  };

  const handleRunPrompt = (card: PromptCard) =>
    trackRun(card.id, () => runPromptAction(card.id));

  const handleRunPinnedPrompt = (prompt: PinnedView) =>
    trackRun(prompt.id, () => runPinnedPrompt(prompt));

  /* ---------- one-time local import ---------- */

  const localCounts = useMemo(
    () => countLocalPocket(pinnedPrompts, cardChanges),
    [pinnedPrompts, cardChanges],
  );
  const localTotal = totalLocalPocket(localCounts);
  const pocketOnline = pocketState.mode === "pocket" && pocketState.online;
  // Offered whenever this device holds local data that is not in the
  // pocket, not only on the first launch: a local-only session on the same
  // device (legacy URL, server down) can add pins after "done". Import is
  // idempotent by contract, so re-offering is safe. After Skip/Never the
  // dialog stays closed but the count stays visible with a way back in.
  const showMigration =
    pocketOnline &&
    localTotal > 0 &&
    (migrationStatus === null ||
      migrationStatus === "done" ||
      migrationStatus === "reopened");
  const showLocalLeftBehind = pocketOnline && localTotal > 0 && !showMigration;

  const importLocal = () =>
    importLocalPocket(
      planLocalImport(pinnedPrompts, cardChanges, cards),
      pocket,
    );

  const finishMigration = () => {
    pocket.setMigrationStatus("done");
    setMigrationStatus("done");
    // Only now, after the verified readback, does local data go away.
    setPinnedPrompts([]);
    setCardChanges(EMPTY_PROMPT_CARD_CHANGES);
  };

  const dismissMigrationForever = () => {
    pocket.setMigrationStatus("dismissed");
    setMigrationStatus("dismissed");
  };

  /* ---------- sync banner ---------- */

  const syncBanner = (() => {
    if (pocketState.mode === "booting") {
      return { label: BOOTING_LABEL, retry: false };
    }
    if (pocketState.mode === "local-only") {
      const { reason, code } = pocketState;
      if (reason === "sync_rejected") {
        return {
          label: `Not synced: ${describeSyncRejection(code)}`,
          retry: isRetryableFailure(reason, code),
        };
      }
      const unreachable = isRetryableFailure(reason, code);
      return {
        label: unreachable ? UNREACHABLE_LABEL : NOT_SYNCED_LABEL,
        retry: unreachable,
      };
    }
    if (pocketState.mode === "pocket" && !pocketState.online) {
      const { offlineReason, offlineCode } = pocketState;
      if (!offlineReason) return { label: BOOTING_LABEL, retry: false };
      const tail =
        offlineReason === "sync_rejected"
          ? describeSyncRejection(offlineCode)
          : "couldn't reach the server";
      return {
        label: `Showing your last synced pocket. ${
          tail.charAt(0).toUpperCase() + tail.slice(1)
        }`,
        retry: isRetryableFailure(offlineReason, offlineCode),
      };
    }
    return null;
  })();

  const renderUnsynced = (
    title: string,
    unsynced: PocketViewRecord["unsynced"],
  ) =>
    unsynced ? (
      <span className="sync-status" role="status">
        {unsynced.error ? (
          <>
            Couldn't sync, try again
            <button
              type="button"
              className="retry-sync-button"
              onClick={() => void pocket.retryChange(unsynced.changeId)}
              aria-label={`Retry sync for ${title}`}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          </>
        ) : (
          "Syncing…"
        )}
      </span>
    ) : null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <img
          className="brand-mark"
          src={m2aiMarkUrl}
          width="48"
          height="48"
          alt="M2AI"
        />
        <div>
          <p className="eyebrow">
            M2AI · AI ENHANCEMENT, ENABLEMENT & EXECUTION
          </p>
          <h1>Prompt Pocket</h1>
          <p className="header-copy">
            Start with one useful prompt, create your own, or map an automation.
            Pin the prompts worth keeping.
          </p>
        </div>
      </header>

      <section className="search-zone" aria-label="Find a prompt">
        <label className="search-box">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email, research, planning…"
            aria-label="Search prompts"
          />
          {query && (
            <button
              className="clear-search"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </label>

        <div className="filter-row" aria-label="Prompt categories">
          {categories.map((item) => (
            <button
              key={item}
              className={`filter-chip ${category === item ? "active" : ""}`}
              onClick={() => {
                setCategory(item);
              }}
              aria-pressed={category === item}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      {syncBanner && (
        <p className="sync-label" role="status">
          {syncBanner.label}
          {syncBanner.retry && (
            <button
              type="button"
              className="retry-sync-button"
              onClick={() => void pocket.bootstrap()}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          )}
        </p>
      )}

      {showLocalLeftBehind && (
        <p className="sync-label" role="status">
          {describeLocalPocket(localCounts)} on this device{" "}
          {localTotal === 1 ? "isn't" : "aren't"} in your pocket
          <button
            type="button"
            className="retry-sync-button"
            onClick={() => setMigrationStatus("reopened")}
          >
            Import
          </button>
        </p>
      )}

      {!supportsOneTapDispatch && !isInTelegramContext && (
        <p className="fallback-banner">
          Tapping a card copies the finished prompt to your clipboard instead of
          sending it automatically.
        </p>
      )}

      {pinnedView.length > 0 && (
        <section
          className="pinned-prompts"
          aria-labelledby="pinned-prompts-title"
        >
          <div className="results-heading">
            <h2 id="pinned-prompts-title">Pinned prompts</h2>
            <span>{pinnedView.length}</span>
          </div>
          <div className="prompt-grid">
            {pinnedView.map((prompt) => {
              const status = runStatus[prompt.id];
              return (
                <article
                  className="prompt-card pinned-prompt-card"
                  key={prompt.id}
                >
                  <div className="card-topline">
                    <span className="category-label">📌 Pinned</span>
                    <button
                      type="button"
                      className="favorite-button"
                      onClick={() => unpinPrompt(prompt)}
                      aria-label={`Unpin ${prompt.title}`}
                    >
                      <PinOff size={20} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="card-open"
                    onClick={() => handleRunPinnedPrompt(prompt)}
                    aria-label={`Run prompt: ${prompt.title}`}
                    disabled={status?.status === "pending"}
                  >
                    <span>
                      <strong>{prompt.title}</strong>
                      <small>{prompt.prompt}</small>
                      {status && (
                        <span className="run-status">
                          {statusLabel(status)}
                        </span>
                      )}
                    </span>
                    <Copy size={20} aria-hidden="true" />
                  </button>
                  {renderUnsynced(prompt.title, prompt.unsynced)}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="results" aria-live="polite">
        <div className="results-heading">
          <h2 ref={resultsHeadingRef} tabIndex={-1}>
            {category === "All" ? "Choose what you need" : category}
          </h2>
          <span>
            {visibleCards.length} {visibleCards.length === 1 ? "card" : "cards"}
          </span>
        </div>

        {visibleCards.length > 0 ? (
          <div className="prompt-grid">
            {visibleCards.map((card) => {
              const status = runStatus[card.id];
              const override =
                card.kind === "prompt" && pocketMode
                  ? findOverride(pocketRecords, card.id)
                  : undefined;
              return (
                <article className="prompt-card" key={card.id}>
                  <div className="card-topline">
                    <span className="category-label">{card.category}</span>
                    {card.kind === "prompt" && (
                      <button
                        type="button"
                        className="edit-card-button"
                        onClick={() => setEditingCardId(card.id)}
                        aria-label={`Edit ${card.title}`}
                      >
                        <Pencil size={17} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                  {card.kind === "prompt" ? (
                    <>
                      <button
                        className="card-open"
                        onClick={() => handleRunPrompt(card)}
                        aria-label={`Run prompt: ${card.title}`}
                        disabled={status?.status === "pending"}
                      >
                        <span>
                          <strong>{card.title}</strong>
                          <small>{card.description}</small>
                          {status && (
                            <span className="run-status">
                              {statusLabel(status)}
                            </span>
                          )}
                        </span>
                        <span className="go-action" aria-hidden="true">
                          GO
                        </span>
                      </button>
                      {renderUnsynced(card.title, override?.unsynced)}
                    </>
                  ) : card.kind === "creator" ? (
                    <button
                      type="button"
                      className="card-open"
                      onClick={() => setIsCreatingPrompt(true)}
                      aria-label="Create a prompt"
                    >
                      <span>
                        <span className="workflow-label">Make your own</span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                      </span>
                      <span className="go-action" aria-hidden="true">
                        GO
                      </span>
                    </button>
                  ) : workflows[card.workflow.id] ? (
                    <button
                      type="button"
                      className="card-open"
                      onClick={() => openWorkflow(card.workflow.id)}
                      aria-label={`Open workflow: ${card.title}`}
                    >
                      <span>
                        <span className="workflow-label">Workflow</span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                      </span>
                      <span className="go-action" aria-hidden="true">
                        GO
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="card-open"
                      aria-label={`Workflow ${card.title} is not available yet`}
                      aria-disabled="true"
                    >
                      <span>
                        <span className="workflow-label">Workflow</span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                        <span className="workflow-status">
                          Not available yet
                        </span>
                      </span>
                      <span className="go-action" aria-hidden="true">
                        GO
                      </span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <Search size={28} />
            <h3>No prompts found</h3>
            <p>Try a broader word or choose another category.</p>
            <button
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
            >
              Show all prompts
            </button>
          </div>
        )}
      </section>

      <footer>
        <p>
          {pocketMode || booting
            ? "Your pocket syncs with this bot. Always review AI output before using it."
            : "Created prompts stay on this device. Always review AI output before using it."}
        </p>
      </footer>

      {activeWorkflowId && workflows[activeWorkflowId] && (
        <WorkflowWizard
          definition={workflows[activeWorkflowId]}
          onClose={closeWorkflow}
          storage={workflowStorage}
        />
      )}
      {isCreatingPrompt && (
        <PromptCreator
          onClose={() => setIsCreatingPrompt(false)}
          onPin={pinPrompt}
        />
      )}
      {editingCard && (
        <PromptCardEditor
          card={editingCard}
          categories={categories.filter((item) => item !== "All")}
          onClose={() => setEditingCardId(null)}
          onSave={saveCardEdit}
          onDelete={deleteCard}
        />
      )}
      {showMigration && (
        <LocalPocketMigration
          counts={localCounts}
          onImport={importLocal}
          onImported={finishMigration}
          onSkip={() => setMigrationStatus("skipped")}
          onNever={dismissMigrationForever}
        />
      )}
    </main>
  );
}
