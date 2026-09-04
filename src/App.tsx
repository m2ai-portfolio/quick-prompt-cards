import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, PinOff, Search, Sparkles, X } from "lucide-react";
import { filterPrompts } from "./prompt-utils";
import { categories, prompts } from "./prompts";
import {
  copyPromptToClipboard,
  isTelegramWebAppSupported,
  runPrompt as dispatchPrompt,
  sendWebAppQuery,
  type RunPromptResult,
} from "./telegram-actions";
import type { Card, PromptCard } from "./types";
import PromptCreator from "./components/PromptCreator";
import { parsePinnedPrompts, type PinnedPrompt } from "./prompt-creator";
import WorkflowWizard from "./components/WorkflowWizard";
import { createAutomationStorage } from "./workflows/wizard-state";
import type { WorkflowDefinition } from "./workflows/types";

const PINNED_PROMPTS_KEY = "prompt-pocket-pinned-prompts";

type RunStatus =
  "pending" | "dispatched" | "fallback-copied" | "unavailable" | "error";

const STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Sending…",
  dispatched: "Sent to Telegram",
  "fallback-copied": "Copied to clipboard",
  unavailable: "Couldn't send — reopen Prompt Pocket to try again",
  error: "Couldn't send — try again",
};

type AppProps = {
  cards?: Card[];
  runPrompt?: (cardId: string) => Promise<RunPromptResult>;
  workflows?: Record<string, WorkflowDefinition>;
};

export default function App({
  cards = prompts,
  runPrompt,
  workflows = {},
}: AppProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [isCreatingPrompt, setIsCreatingPrompt] = useState(false);
  const [pinnedPrompts, setPinnedPrompts] = useState<PinnedPrompt[]>(() => {
    try {
      return parsePinnedPrompts(localStorage.getItem(PINNED_PROMPTS_KEY));
    } catch {
      return [];
    }
  });
  // Created once per App mount (a tab session) so its in-memory fallback
  // persists across a workflow wizard closing and reopening in that same
  // tab, instead of resetting with each WorkflowWizard mount.
  const [workflowStorage] = useState(() => createAutomationStorage());

  const openWorkflow = (workflowId: string) => {
    if (!workflows[workflowId]) return;
    setActiveWorkflowId(workflowId);
  };

  const closeWorkflow = () => setActiveWorkflowId(null);

  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );

  const isInTelegramContext = Boolean(window.Telegram?.WebApp);

  const defaultRunPrompt = useMemo(
    () => (cardId: string) => {
      const card = cardsById.get(cardId) as PromptCard;
      return dispatchPrompt(card, {
        isInTelegram: () => isInTelegramContext,
        supportsOneTapDispatch: isTelegramWebAppSupported,
        sendWebAppQuery,
        copyToClipboard: copyPromptToClipboard,
      });
    },
    [cardsById, isInTelegramContext],
  );
  const runPromptAction = runPrompt ?? defaultRunPrompt;

  // window.Telegram?.WebApp presence only tells us the page loaded inside a
  // Telegram launch, not whether one-tap dispatch actually works there. A3
  // (validated init data -> server-resolved prompt) hasn't shipped, so
  // isTelegramWebAppSupported() is the only source of truth for whether a
  // tap will dispatch. The clipboard fallback is plain-browser only: inside
  // Telegram without dispatch support, a tap surfaces an honest
  // "unavailable" result instead.
  const supportsOneTapDispatch = isTelegramWebAppSupported();

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

  const pinPrompt = (prompt: PinnedPrompt) => {
    setPinnedPrompts((current) => [
      prompt,
      ...current.filter((item) => item.id !== prompt.id),
    ]);
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
  };

  const unpinPrompt = (id: string) => {
    setPinnedPrompts((current) => current.filter((item) => item.id !== id));
  };

  const visibleCards = useMemo(() => {
    return filterPrompts(cards, query, category);
  }, [cards, category, query]);

  const clearRunStatus = (id: string) => {
    setRunStatus((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const handleRunPrompt = async (card: PromptCard) => {
    if (runStatus[card.id] === "pending") return;

    setRunStatus((current) => ({ ...current, [card.id]: "pending" }));
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");

    try {
      const result = await runPromptAction(card.id);
      setRunStatus((current) => ({ ...current, [card.id]: result.status }));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(
        result.status === "dispatched" ? "success" : "warning",
      );
    } catch {
      setRunStatus((current) => ({ ...current, [card.id]: "error" }));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    }

    window.setTimeout(() => clearRunStatus(card.id), 2600);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <Sparkles size={20} strokeWidth={2.2} />
        </div>
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

      {!supportsOneTapDispatch && !isInTelegramContext && (
        <p className="fallback-banner">
          Tapping a card copies the finished prompt to your clipboard instead of
          sending it automatically.
        </p>
      )}

      {pinnedPrompts.length > 0 && (
        <section
          className="pinned-prompts"
          aria-labelledby="pinned-prompts-title"
        >
          <div className="results-heading">
            <h2 id="pinned-prompts-title">Pinned prompts</h2>
            <span>{pinnedPrompts.length}</span>
          </div>
          <div className="prompt-grid">
            {pinnedPrompts.map((prompt) => (
              <article
                className="prompt-card pinned-prompt-card"
                key={prompt.id}
              >
                <div className="card-topline">
                  <span className="category-label">📌 Pinned</span>
                  <button
                    type="button"
                    className="favorite-button"
                    onClick={() => unpinPrompt(prompt.id)}
                    aria-label={`Unpin ${prompt.title}`}
                  >
                    <PinOff size={20} />
                  </button>
                </div>
                <button
                  type="button"
                  className="card-open"
                  onClick={() => navigator.clipboard.writeText(prompt.prompt)}
                  aria-label={`Copy pinned prompt: ${prompt.title}`}
                >
                  <span>
                    <strong>{prompt.title}</strong>
                    <small>{prompt.prompt}</small>
                  </span>
                  <Copy size={20} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="results" aria-live="polite">
        <div className="results-heading">
          <h2>{category === "All" ? "Choose what you need" : category}</h2>
          <span>
            {visibleCards.length} {visibleCards.length === 1 ? "card" : "cards"}
          </span>
        </div>

        {visibleCards.length > 0 ? (
          <div className="prompt-grid">
            {visibleCards.map((card) => {
              const status = runStatus[card.id];
              return (
                <article className="prompt-card" key={card.id}>
                  <div className="card-topline">
                    <span className="category-label">{card.category}</span>
                  </div>
                  {card.kind === "prompt" ? (
                    <button
                      className="card-open"
                      onClick={() => handleRunPrompt(card)}
                      aria-label={`Run prompt: ${card.title}`}
                      disabled={status === "pending"}
                    >
                      <span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                        {status && (
                          <span className="run-status">
                            {STATUS_LABEL[status]}
                          </span>
                        )}
                      </span>
                      <ChevronRight size={21} aria-hidden="true" />
                    </button>
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
                      <ChevronRight size={21} aria-hidden="true" />
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
                      <ChevronRight size={21} aria-hidden="true" />
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
                      <ChevronRight size={21} aria-hidden="true" />
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
          Created prompts stay on this device. Always review AI output before
          using it.
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
    </main>
  );
}
