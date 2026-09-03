import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WorkflowDefinition } from "../workflows/types";
import {
  clearWizardState,
  createWizardState,
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
  const [state, setState] = useState(
    () => loadWizardState(definition) ?? createWizardState(definition),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  const step = definition.steps[state.stepIndex];
  const isLast = isLastStep(state, definition);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
    headingRef.current?.focus();
  }, [state.stepIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAnswerChange = (key: string, value: string) => {
    setState((current) => {
      const next = updateAnswer(current, key, value);
      saveWizardState(next);
      return next;
    });
  };

  const handleNext = () => {
    setState((current) => {
      const next = goNext(current, definition);
      if (Object.keys(next.errors).length === 0) {
        saveWizardState(next);
        if (isLastStep(current, definition)) {
          clearWizardState(definition.id);
          onComplete?.();
        }
      }
      return next;
    });
  };

  const handleBack = () => {
    setState((current) => {
      const next = goBack(current);
      saveWizardState(next);
      return next;
    });
  };

  const handleClose = () => {
    saveWizardState(state);
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

        <h3 ref={headingRef} tabIndex={-1} className="wizard-step-title">
          {step.title}
        </h3>
        {step.description && (
          <p className="wizard-step-description">{step.description}</p>
        )}

        <div className="wizard-fields">
          {step.fields.map((field) => {
            const FieldElement =
              field.type === "textarea" ? "textarea" : "input";
            const errorId = `${field.key}-error`;
            const error = state.errors[field.key];
            return (
              <label key={field.key} className="wizard-field">
                <span>{field.label}</span>
                <FieldElement
                  value={state.answers[field.key] ?? ""}
                  onChange={(event) =>
                    handleAnswerChange(field.key, event.target.value)
                  }
                  placeholder={field.placeholder}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? errorId : undefined}
                  rows={field.type === "textarea" ? 4 : undefined}
                />
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
