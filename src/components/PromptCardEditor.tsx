import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { PromptCard } from "../types";
import type { PromptCardEdit } from "../card-customizations";

type PromptCardEditorProps = {
  card: PromptCard;
  categories: readonly string[];
  onClose: () => void;
  onSave: (edit: PromptCardEdit) => void;
  onDelete: (id: string) => void;
};

export default function PromptCardEditor({
  card,
  categories,
  onClose,
  onSave,
  onDelete,
}: PromptCardEditorProps) {
  const [title, setTitle] = useState(card.title);
  const [category, setCategory] = useState(card.category);
  const [prompt, setPrompt] = useState(card.prompt);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );
  const valid = Boolean(title.trim() && category.trim() && prompt.trim());

  useEffect(() => {
    headingRef.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const getFocusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIsFocusable = active ? focusable.includes(active) : false;

      if (event.shiftKey && (active === first || !activeIsFocusable)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !activeIsFocusable)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="wizard-layer" role="presentation">
      <section
        ref={dialogRef}
        className="workflow-wizard card-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-editor-title"
      >
        <header className="wizard-header">
          <div>
            <p className="dialog-kicker">Prompt card</p>
            <h2 ref={headingRef} id="card-editor-title" tabIndex={-1}>
              {confirmingDelete
                ? `Delete ${card.title}?`
                : `Edit ${card.title}`}
            </h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            <X size={21} />
          </button>
        </header>

        {confirmingDelete ? (
          <div className="delete-confirmation">
            <p>
              This removes the card from this device. You cannot undo this
              action.
            </p>
            <div className="wizard-actions destructive-actions">
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Keep card
              </button>
              <button type="button" onClick={() => onDelete(card.id)}>
                Yes, delete this card
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="wizard-fields editor-fields">
              <label className="wizard-field">
                Category
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {categories.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wizard-field">
                Card name
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="wizard-field">
                Prompt
                <textarea
                  rows={8}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            </div>
            <div className="editor-actions">
              <button
                type="button"
                className="delete-card-button"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={18} aria-hidden="true" />
                Delete card
              </button>
              <button
                type="button"
                className="save-card-button"
                disabled={!valid}
                onClick={() =>
                  onSave({
                    id: card.id,
                    title: title.trim(),
                    category: category.trim(),
                    prompt: prompt.trim(),
                  })
                }
              >
                Save changes
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
