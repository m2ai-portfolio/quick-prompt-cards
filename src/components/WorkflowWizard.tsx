import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { isTerminalStatus, type WorkflowDefinition } from "../workflows/types";
import {
  clearWizardState,
  createAutomationStorage,
  createWizardState,
  goBack,
  goNext,
  isLastStep,
  loadWizardState,
  saveWizardState,
  updateAnswer,
  type AutomationStorage,
} from "../workflows/wizard-state";

type WorkflowWizardProps = {
  definition: WorkflowDefinition;
  onClose: () => void;
  onComplete?: () => void;
  // Session-scoped storage adapter, hoisted by the caller (App) so its
  // in-memory fallback map survives this component unmounting on close and
  // remounting on reopen within the same tab. Falls back to a private
  // instance for standalone use (e.g. tests rendering the wizard directly).
  storage?: AutomationStorage;
};

// answers is workflow-owned (contract rule 5): a value can be any object,
// including one whose toString is missing or non-callable (e.g.
// Object.create(null)). String()/toString() on those throws, so this must
// never call through to an unverified method.
function toFieldDisplayValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  try {
    return String(raw);
  } catch {
    return "[unsupported value]";
  }
}

export default function WorkflowWizard({
  definition,
  onClose,
  onComplete,
  storage: storageProp,
}: WorkflowWizardProps) {
  const [ownStorage] = useState(() => createAutomationStorage());
  const storage = storageProp ?? ownStorage;
  const [initialLoad] = useState(() => loadWizardState(definition, storage));
  const [state, setState] = useState(initialLoad.state);
  const [showResetNotice] = useState(initialLoad.outcome === "reset");
  const [storageAvailable, setStorageAvailable] = useState(
    initialLoad.storageAvailable,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);
  // Captured at render time, before any effect can move focus elsewhere.
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );

  const step = definition.steps[state.stepIndex];
  const isLast = isLastStep(state, definition);
  const isTerminal = isTerminalStatus(state.status);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
    headingRef.current?.focus();
  }, [state.stepIndex]);

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    return () => {
      previouslyFocused?.focus?.();
    };
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
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current?.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAnswerChange = (key: string, value: string) => {
    if (isTerminal) return;
    setState((current) => {
      const next = updateAnswer(current, key, value);
      setStorageAvailable(saveWizardState(next, definition, storage));
      return next;
    });
  };

  const handleNext = () => {
    setState((current) => {
      const next = goNext(current, definition);
      if (Object.keys(next.errors).length === 0) {
        if (isLastStep(current, definition)) {
          // Finishing must persist a terminal record, not clear it: an
          // erased record resumes as "fresh" (an editable draft) on the
          // next open, silently reopening a completed automation (contract
          // "single-use/retry boundary").
          const completed = { ...next, status: "completed" as const };
          setStorageAvailable(saveWizardState(completed, definition, storage));
          onComplete?.();
          return completed;
        }
        setStorageAvailable(saveWizardState(next, definition, storage));
      }
      return next;
    });
  };

  const handleBack = () => {
    setState((current) => {
      const next = goBack(current);
      setStorageAvailable(saveWizardState(next, definition, storage));
      return next;
    });
  };

  const handleClose = () => {
    setStorageAvailable(saveWizardState(state, definition, storage));
    onClose();
  };

  const handleRestart = () => {
    // Explicit user action, not an implicit reopen: a finished record is
    // terminal per the contract, so starting over must clear it deliberately
    // rather than the wizard silently reusing or discarding it on its own.
    setStorageAvailable(clearWizardState(definition.id, storage));
    setState(createWizardState(definition));
  };

  if (!step) return null;

  return (
    <div
      className="wizard-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        ref={dialogRef}
        className="workflow-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
      >
        <div className="wizard-header">
          <h2 id="wizard-title">{definition.title}</h2>
          <button
            type="button"
            className="close-button"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {showResetNotice && (
          <p role="status" className="wizard-notice wizard-reset-notice">
            We couldn&apos;t resume your previous progress, so this workflow has
            started fresh.
          </p>
        )}
        {!storageAvailable && (
          <p role="status" className="wizard-notice wizard-storage-warning">
            Your progress can&apos;t be saved right now, so it will be lost if
            you reload or close this tab.
          </p>
        )}
        {isTerminal && (
          <p role="status" className="wizard-notice wizard-terminal-notice">
            This workflow has already been {state.status} and can no longer be
            edited.
          </p>
        )}

        <h3 ref={headingRef} tabIndex={-1} className="wizard-step-title">
          {step.title}
        </h3>
        {step.description && (
          <p className="wizard-step-description">{step.description}</p>
        )}

        <div className="wizard-fields">
          {step.fields.map((field) => {
            const errorId = `${field.key}-error`;
            const error = state.errors[field.key];
            const rawValue = state.answers[field.key];
            const value = toFieldDisplayValue(rawValue);
            const commonProps = {
              "aria-invalid": error ? ("true" as const) : undefined,
              "aria-describedby": error ? errorId : undefined,
            };

            let control: ReactNode;
            if (isTerminal) {
              control = (
                <span className="wizard-field-value">{value || "—"}</span>
              );
            } else if (field.type === "select") {
              control = (
                <select
                  value={value}
                  onChange={(event) =>
                    handleAnswerChange(field.key, event.target.value)
                  }
                  {...commonProps}
                >
                  <option value="" disabled hidden>
                    {field.placeholder ?? "Select an option"}
                  </option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              );
            } else if (field.type === "textarea") {
              control = (
                <textarea
                  value={value}
                  onChange={(event) =>
                    handleAnswerChange(field.key, event.target.value)
                  }
                  placeholder={field.placeholder}
                  rows={4}
                  {...commonProps}
                />
              );
            } else {
              control = (
                <input
                  value={value}
                  onChange={(event) =>
                    handleAnswerChange(field.key, event.target.value)
                  }
                  placeholder={field.placeholder}
                  {...commonProps}
                />
              );
            }

            return (
              <label key={field.key} className="wizard-field">
                <span>{field.label}</span>
                {control}
                {field.help && <small>{field.help}</small>}
                {error && (
                  <small id={errorId} className="wizard-field-error">
                    {error}
                  </small>
                )}
              </label>
            );
          })}
        </div>

        {!isTerminal && (
          <div className="wizard-actions">
            <button
              type="button"
              onClick={handleBack}
              disabled={state.stepIndex === 0}
            >
              Back
            </button>
            <button type="button" onClick={handleNext}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        )}
        {isTerminal && (
          <div className="wizard-actions">
            <button type="button" onClick={handleRestart}>
              Start over
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
