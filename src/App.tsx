import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  Copy,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { buildPrompt, filterPrompts, toggleFavorite } from "./prompt-utils";
import { categories, prompts } from "./prompts";
import type { PromptCard } from "./types";

const FAVORITES_KEY = "prompt-pocket-favorites";

export default function App() {
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
  const [selectedPrompt, setSelectedPrompt] = useState<PromptCard | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.Telegram?.WebApp.ready();
    window.Telegram?.WebApp.expand();
  }, []);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const visiblePrompts = useMemo(() => {
    const filtered = filterPrompts(prompts, query, category);
    return favoritesOnly
      ? filtered.filter((prompt) => favorites.includes(prompt.id))
      : filtered;
  }, [category, favorites, favoritesOnly, query]);

  const openPrompt = (prompt: PromptCard) => {
    setSelectedPrompt(prompt);
    setAnswers({});
    setCopied(false);
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  };

  const closePrompt = () => {
    setSelectedPrompt(null);
    setAnswers({});
    setCopied(false);
  };

  const updateFavorite = (id: string) => {
    setFavorites((current) => toggleFavorite(current, id));
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  };

  const finishedPrompt = selectedPrompt
    ? buildPrompt(selectedPrompt.template, answers)
    : "";

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(finishedPrompt);
    setCopied(true);
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <Sparkles size={20} strokeWidth={2.2} />
        </div>
        <div>
          <p className="eyebrow">STACEY'S AI TOOLKIT</p>
          <h1>Prompt Pocket</h1>
          <p className="header-copy">
            Pick a task. Add your details. Copy a prompt that is ready to use.
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
            {visiblePrompts.length}{" "}
            {visiblePrompts.length === 1 ? "prompt" : "prompts"}
          </span>
        </div>

        {visiblePrompts.length > 0 ? (
          <div className="prompt-grid">
            {visiblePrompts.map((prompt) => {
              const isFavorite = favorites.includes(prompt.id);
              return (
                <article className="prompt-card" key={prompt.id}>
                  <div className="card-topline">
                    <span className="category-label">{prompt.category}</span>
                    <button
                      className="favorite-button"
                      onClick={() => updateFavorite(prompt.id)}
                      aria-label={`${isFavorite ? "Remove" : "Add"} ${prompt.title} ${isFavorite ? "from" : "to"} favorites`}
                      aria-pressed={isFavorite}
                    >
                      {isFavorite ? (
                        <BookmarkCheck size={20} />
                      ) : (
                        <Bookmark size={20} />
                      )}
                    </button>
                  </div>
                  <button
                    className="card-open"
                    onClick={() => openPrompt(prompt)}
                    aria-label={`Open ${prompt.title}`}
                  >
                    <span>
                      <strong>{prompt.title}</strong>
                      <small>{prompt.description}</small>
                    </span>
                    <ChevronRight size={21} aria-hidden="true" />
                  </button>
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
          Prompts help the AI understand your goal. Always review the answer
          before using it.
        </p>
      </footer>

      {selectedPrompt && (
        <div
          className="drawer-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePrompt();
          }}
        >
          <section
            className="prompt-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            <div className="drawer-handle" aria-hidden="true" />
            <div className="drawer-header">
              <div>
                <span className="category-label">
                  {selectedPrompt.category}
                </span>
                <h2 id="drawer-title">{selectedPrompt.title}</h2>
                <p>{selectedPrompt.description}</p>
              </div>
              <button
                className="close-button"
                onClick={closePrompt}
                aria-label="Close prompt"
              >
                <X size={22} />
              </button>
            </div>

            <div className="guided-fields">
              <div className="section-label">
                <span>1</span>
                <h3>Add your details</h3>
              </div>
              {selectedPrompt.fields.map((field) => {
                const FieldElement = field.multiline ? "textarea" : "input";
                return (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <FieldElement
                      value={answers[field.key] ?? ""}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      rows={field.multiline ? 4 : undefined}
                    />
                    {field.help && <small>{field.help}</small>}
                  </label>
                );
              })}
            </div>

            <div className="prompt-preview">
              <div className="section-label">
                <span>2</span>
                <h3>Your finished prompt</h3>
              </div>
              <pre>{finishedPrompt}</pre>
            </div>

            <div className="drawer-actions">
              <button
                className={`copy-button ${copied ? "copied" : ""}`}
                onClick={copyPrompt}
              >
                {copied ? <Check size={20} /> : <Copy size={20} />}
                {copied ? "Copied and ready" : "Copy finished prompt"}
              </button>
              <p>
                Paste it into Gemini, ChatGPT, Claude, or another AI assistant.
              </p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
