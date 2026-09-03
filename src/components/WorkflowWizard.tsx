import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { WorkflowDefinition } from "../workflows/types";
import {
  clearWizardState,
  createAutomationStorage,
  goBack,
  goNext,
  isLastStep,
  loadWizardState,
  saveWizardState,
  updateAnswer,
} from "../workflows/wizard-state";

type WorkflowWizardProps = {
  definition: WorkflowDefinition;
  onClose: () => void;
  onComplete?: () => void;
};

export default function WorkflowWizard({
  definition,
  onClose,
  onComplete,
}: WorkflowWizardProps) {
  const [storage] = useState(() => createAutomationStorage());
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
          setStorageAvailable(clearWizardState(definition.id, storage));
          onComplete?.();
          return next;
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
            const value = state.answers[field.key] ?? "";
            const commonProps = {
              "aria-invalid": error ? ("true" as const) : undefined,
              "aria-describedby": error ? errorId : undefined,
            };

            let control: ReactNode;
            if (field.type === "select") {
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
      </section>
    </div>
  );
}
