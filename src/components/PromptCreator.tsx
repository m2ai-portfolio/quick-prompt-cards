import { useState } from "react";
import { X } from "lucide-react";
import { createPromptDraft, type PinnedPrompt } from "../prompt-creator";

type PromptCreatorProps = {
  onClose: () => void;
  onPin: (prompt: PinnedPrompt) => void;
};

export default function PromptCreator({ onClose, onPin }: PromptCreatorProps) {
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [format, setFormat] = useState("");
  const [createdPrompt, setCreatedPrompt] = useState<PinnedPrompt | null>(null);
  const [error, setError] = useState("");

  const createPrompt = () => {
    if (!goal.trim()) {
      setError("Tell us what the prompt should help you do.");
      return;
    }
    setError("");
    setCreatedPrompt(createPromptDraft({ goal, context, format }));
  };

  const pinPrompt = () => {
    if (!createdPrompt) return;
    onPin(createdPrompt);
    onClose();
  };

  return (
    <div className="wizard-layer" role="presentation">
      <section
        className="workflow-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-creator-title"
      >
        <div className="wizard-header">
          <h2 id="prompt-creator-title">
            {createdPrompt ? "Your prompt" : "Create a prompt"}
          </h2>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {createdPrompt ? (
          <>
            <p className="wizard-step-description">
              Review it now. If it feels useful, pin it to your pocket.
            </p>
            <div className="created-prompt" data-testid="created-prompt">
              {createdPrompt.prompt}
            </div>
            <div className="wizard-actions prompt-creator-actions">
              <button type="button" onClick={() => setCreatedPrompt(null)}>
                Edit
              </button>
              <button
                type="button"
                onClick={pinPrompt}
                aria-label="Pin this prompt"
              >
                📌 Pin this prompt
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="wizard-step-description">
              Tell Prompt Pocket what you want. You can review the finished
              prompt before pinning it.
            </p>
            <div className="wizard-fields">
              <label className="wizard-field">
                <span>What should this prompt help you do?</span>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Turn meeting notes into clear action items"
                  rows={3}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? "prompt-goal-error" : undefined}
                />
                {error && (
                  <small id="prompt-goal-error" className="wizard-field-error">
                    {error}
                  </small>
                )}
              </label>
              <label className="wizard-field">
                <span>What should it know?</span>
                <textarea
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                  placeholder="Audience, situation, source material, or constraints"
                  rows={3}
                />
              </label>
              <label className="wizard-field">
                <span>How should the answer look?</span>
                <input
                  value={format}
                  onChange={(event) => setFormat(event.target.value)}
                  placeholder="A checklist, email, table, short plan…"
                />
              </label>
            </div>
            <div className="wizard-actions prompt-creator-actions">
              <span />
              <button type="button" onClick={createPrompt}>
                Create my prompt
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
