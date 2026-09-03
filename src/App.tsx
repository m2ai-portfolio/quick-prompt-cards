import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { filterPrompts, toggleFavorite } from "./prompt-utils";
import { categories, prompts } from "./prompts";
import {
  copyPromptToClipboard,
  isTelegramWebAppSupported,
  runPrompt as dispatchPrompt,
  sendWebAppQuery,
  type RunPromptResult,
} from "./telegram-actions";
import type { Card, PromptCard } from "./types";
import WorkflowWizard from "./components/WorkflowWizard";
import type { WorkflowDefinition } from "./workflows/types";

const FAVORITES_KEY = "prompt-pocket-favorites";

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
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(FAVORITES_KEY) ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);

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
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const visibleCards = useMemo(() => {
    const filtered = filterPrompts(cards, query, category);
    return favoritesOnly
      ? filtered.filter((prompt) => favorites.includes(prompt.id))
      : filtered;
  }, [cards, category, favorites, favoritesOnly, query]);

  const updateFavorite = (id: string) => {
    setFavorites((current) => toggleFavorite(current, id));
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  };

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
            Tap a card to run it. Every prompt is ready to go, no filling in
            blanks and no copy-paste.
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
          <button
            className={`filter-chip favorite-filter ${favoritesOnly ? "active" : ""}`}
            onClick={() => setFavoritesOnly((value) => !value)}
            aria-pressed={favoritesOnly}
          >
            <Bookmark size={16} /> Favorites
          </button>
          {categories.map((item) => (
            <button
              key={item}
              className={`filter-chip ${category === item && !favoritesOnly ? "active" : ""}`}
              onClick={() => {
                setCategory(item);
                setFavoritesOnly(false);
              }}
              aria-pressed={category === item && !favoritesOnly}
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

      <section className="results" aria-live="polite">
        <div className="results-heading">
          <h2>
            {favoritesOnly
              ? "Your favorites"
              : category === "All"
                ? "Choose what you need"
                : category}
          </h2>
          <span>
            {visibleCards.length} {visibleCards.length === 1 ? "card" : "cards"}
          </span>
        </div>

        {visibleCards.length > 0 ? (
          <div className="prompt-grid">
            {visibleCards.map((card) => {
              const isFavorite = favorites.includes(card.id);
              const status = runStatus[card.id];
              return (
                <article className="prompt-card" key={card.id}>
                  <div className="card-topline">
                    <span className="category-label">{card.category}</span>
                    <button
                      className="favorite-button"
                      onClick={() => updateFavorite(card.id)}
                      aria-label={`${isFavorite ? "Remove" : "Add"} ${card.title} ${isFavorite ? "from" : "to"} favorites`}
                      aria-pressed={isFavorite}
                    >
                      {isFavorite ? (
                        <BookmarkCheck size={20} />
                      ) : (
                        <Bookmark size={20} />
                      )}
                    </button>
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
                setFavoritesOnly(false);
              }}
            >
              Show all prompts
            </button>
          </div>
        )}
      </section>

      <footer>
        <p>
          Every prompt card sends a complete, ready-to-run prompt with one tap.
          Always review the response before using it.
        </p>
      </footer>

      {activeWorkflowId && workflows[activeWorkflowId] && (
        <WorkflowWizard
          definition={workflows[activeWorkflowId]}
          onClose={closeWorkflow}
        />
      )}
    </main>
  );
}
