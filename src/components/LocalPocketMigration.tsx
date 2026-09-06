import { useEffect, useRef, useState } from "react";
import {
  describeLocalPocket,
  totalLocalPocket,
  type ImportOutcome,
  type LocalPocketCounts,
} from "../local-migration";

type LocalPocketMigrationProps = {
  counts: LocalPocketCounts;
  /** Uploads and verifies; resolves to the outcome, never throws. */
  onImport: () => Promise<ImportOutcome>;
  /** Keep local data, ask again next launch. */
  onSkip: () => void;
  /** Keep local data, record `dismissed`, stop asking. */
  onNever: () => void;
  /** Called after a verified import so the host can clear local data. */
  onImported: (outcome: Extract<ImportOutcome, { ok: true }>) => void;
};

const FAILURE_COPY: Record<
  Extract<ImportOutcome, { ok: false }>["reason"],
  string
> = {
  import_failed:
    "Couldn't import. Your prompts are still on this device. Try again.",
  readback_failed:
    "Couldn't confirm the import. Your prompts are still on this device. Try again.",
  unmapped_local_ids:
    "The server didn't account for every prompt. Your prompts are still on this device. Try again.",
  missing_from_readback:
    "The imported prompts didn't come back from the server. Your prompts are still on this device. Try again.",
};

export default function LocalPocketMigration({
  counts,
  onImport,
  onSkip,
  onNever,
  onImported,
}: LocalPocketMigrationProps) {
  const [importing, setImporting] = useState(false);
  const [failure, setFailure] = useState<
    Extract<ImportOutcome, { ok: false }>["reason"] | null
  >(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const total = totalLocalPocket(counts);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (total === 0) return null;

  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setFailure(null);
    const outcome = await onImport();
    setImporting(false);
    if (outcome.ok) {
      onImported(outcome);
      return;
    }
    setFailure(outcome.reason);
  };

  return (
    <div className="wizard-layer" role="presentation">
      <section
        className="workflow-wizard migration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-migration-title"
      >
        <header className="wizard-header">
          <div>
            <p className="dialog-kicker">Your pocket</p>
            <h2 ref={headingRef} id="local-migration-title" tabIndex={-1}>
              Move your prompts into your pocket?
            </h2>
          </div>
        </header>
        <p className="wizard-step-description">
          This device holds {describeLocalPocket(counts)}. Import them to use
          them from Hermes1 and Beth on any device. Nothing is uploaded until
          you tap Import.
        </p>
        {failure && (
          <p role="alert" className="wizard-notice wizard-storage-warning">
            {FAILURE_COPY[failure]}
          </p>
        )}
        <div className="wizard-actions migration-actions">
          <button type="button" onClick={onNever} disabled={importing}>
            Never
          </button>
          <button type="button" onClick={onSkip} disabled={importing}>
            Skip
          </button>
          <button
            type="button"
            className="save-card-button"
            onClick={runImport}
            disabled={importing}
          >
            {importing ? "Importing…" : failure ? "Try again" : "Import"}
          </button>
        </div>
      </section>
    </div>
  );
}
