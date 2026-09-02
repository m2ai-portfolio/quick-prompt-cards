# Contract: automation-state/v1

Status: frozen (A1). No implementation exists yet. Governs A5 (generic wizard shell) and A6
(Silver Platter first slice). This is the browser-local persistence contract only; it is not
the Silver Platter server-execution contract (`contracts/silver-platter-compatibility-v1.md`,
owned by a later phase per the blueprint) and does not define server-side executor authority.

## Scope

`automation-state-v1` describes how an in-progress guided workflow (an "automation card")
survives a closed tab / backgrounded Mini App and resumes. It is generic across workflows;
it carries no Silver Platter-specific field names.

## Request / write surface

There is no network request in this contract: it is local persistence only (localStorage or
equivalent browser storage), written and read entirely client-side. The "request" is the
wizard engine's read/write call to the storage boundary below.

```ts
type AutomationStateV1 = {
  contract: "automation-state/v1";
  workflowId: string;          // e.g. "silver-platter"
  schemaVersion: string;       // workflow-owned, e.g. "1.0"
  currentStageId: string;
  status: "draft" | "review" | "submitted" | "completed" | "blocked";
  answers: Record<string, unknown>; // workflow-owned shape; this contract does not validate contents
  completedStageIds: string[];
  updatedAt: string;           // ISO 8601
};
```

## Validation rules

Validation is whole-object: every field in `AutomationStateV1` is checked before the object
is trusted for `resumed`. Any single field failing its check is treated identically to a
contract/workflowId mismatch — full discard, not partial salvage (see rule 2 below and the
`reset` outcome).

1. On read, the engine checks `contract === "automation-state/v1"` and `workflowId` /
   `schemaVersion` match the currently mounted workflow's expected values.
2. Any mismatch (wrong contract tag, wrong workflowId, unrecognized/older/newer
   `schemaVersion` the current workflow build does not know how to migrate) is treated as
   **corrupt/incompatible state**, never as a partial-trust merge. The engine does not
   attempt field-by-field salvage across schema versions in v1.
3. `currentStageId` must be a member of the workflow's own declared stage ID list at read
   time; an unknown stage ID is also treated as corrupt state.
4. `status` must be exactly one of `"draft" | "review" | "submitted" | "completed" |
   "blocked"`; any other value (including `null`, `undefined`, or a differently-cased string)
   is corrupt state.
5. `answers` must be a plain object (not `null`, not an array, not a primitive). The engine
   does not validate its internal shape (workflow-owned), only that the container itself is
   the declared type.
6. `completedStageIds` must be an array, and every element must be a string. A non-array
   value, or an array containing a non-string element, is corrupt state.
7. `updatedAt` must be a string that parses as a valid ISO 8601 date (i.e.
   `!Number.isNaN(Date.parse(updatedAt))`); an unparsable or missing value is corrupt state.
8. Any field failing rules 3-7, or any required field (`contract`, `workflowId`,
   `schemaVersion`, `currentStageId`, `status`, `answers`, `completedStageIds`, `updatedAt`)
   being absent, triggers the same `reset` outcome as rule 2's mismatch. The engine never
   partially accepts a state object with some fields valid and others not.
9. Client-authored fields are never granted executor authority. `status`, `currentStageId`,
   and `completedStageIds` are local UI/progress bookkeeping only — if this state is ever
   submitted to a server (out of this contract's scope; see Silver Platter compatibility
   contract), the server independently recomputes completion/authority and does not trust
   these fields as given.

## Outcomes

| Outcome | Condition | Behavior |
|---|---|---|
| `resumed` | Valid, matching contract/workflowId/schemaVersion, known `currentStageId` | Wizard reopens at `currentStageId` with `answers` populated. |
| `fresh` | No stored state for this `workflowId` | Wizard opens at the workflow's declared entry stage with empty `answers`. |
| `reset` | Stored state fails any validation rule (2-8) | Corrupt/incompatible state is discarded (not silently patched); wizard opens fresh at the entry stage. The discard itself is not silently invisible to the user — the workflow shell surfaces a one-line "we couldn't resume your previous progress" notice. |

## Idempotency

Writes are idempotent by replacement: each write fully overwrites the prior
`AutomationStateV1` object for a given `workflowId` key. There is no partial-field patch
operation in v1, which is what makes rule 2 (whole-object corruption handling, not
field-level salvage) safe.

## Single-use / retry boundary

Not applicable in the network sense (no network call). The equivalent boundary is: a
`completed` or `submitted` status is terminal for that stored object — the engine does not
silently reopen a `completed` automation into an editable draft. Restarting the workflow
from the card explicitly creates a new state object (fresh `updatedAt`, stage reset to
entry) rather than mutating the terminal one in place, so a user cannot accidentally
resubmit or corrupt a workflow already handed off to a server-side executor.

## Fallback boundary

If the browser storage API is unavailable or throws (private browsing restrictions, quota
exceeded, disabled storage), the workflow falls back to in-memory-only state for that
session: it functions for the current tab but does not survive a reload. The user is told
explicitly that progress will not be saved, before they invest time in the workflow, not
after data loss.

## Storage boundary

- Storage key must be namespaced per `workflowId` (e.g. `prompt-pocket:automation-state:v1:
  <workflowId>`), so two different automation cards never collide or cross-contaminate state.
- No business-sensitive answer content is sent to any server as part of this contract; this
  contract governs local persistence only. Server submission (if any) is defined by the
  workflow's own submission contract (e.g. Silver Platter's `SilverPlatterBrowserSubmissionV1`
  in the blueprint), which is out of scope here.
- No credential, token, or filesystem path is ever a valid value in `answers`; the generic
  engine does not enforce this by type (it is workflow-owned data), but no workflow may
  place one there — this is a hard product boundary from the parent goal (MAI-364), not a
  detail specific to this contract.
