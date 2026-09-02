# Prompt Pocket Silver Platter Implementation Plan

> **For Hermes:** Execute this plan phase by phase. Use a fresh bounded implementation worker only after the phase schema/status gate passes. Require independent review before advancing.

**Goal:** Evolve Prompt Pocket into an M2AI-branded Telegram Mini App where prompt cards can send a chosen instruction into the bot chat and the first workflow card opens a resumable Silver Platter wizard.

**Architecture:** Keep the React/Vite Mini App as an untrusted presentation layer. Model ordinary prompt cards and workflow cards as a discriminated union. Telegram message delivery and Silver Platter execution live behind server-side adapters so bot tokens, local skill files, and filesystem paths never enter the browser bundle. Build one vertical slice at a time with RED, GREEN, REFACTOR, mandatory phase tests, an independent Paperclip-native review, and a durable tracker update.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Telegram Mini Apps API, a later server-side bot adapter, and the canonical Silver Platter skill at `/home/apexaipc/.claude/skills/silver-platter`.

---

## Verified baseline

- Repository: `/home/apexaipc/projects/products/quick-prompt-cards`, clean `main` at `d2f3c8c` and synchronized with `origin/main` when Phase 0 started.
- Current card schema: `PromptCard` contains `id`, `title`, `description`, `category`, `tags`, `template`, `fields`, and optional `example`.
- Current action: the app builds a prompt and copies it to the clipboard. It has no workflow-card kind, wizard state, Telegram delivery adapter, or backend.
- Current host types expose `ready`, `expand`, `close`, color scheme, and haptics only.
- Current deployment is static GitHub Pages. It cannot safely hold a Telegram bot token or execute a local Claude skill.
- Canonical Silver Platter outputs: four mandatory files, `data_map.json`, `data_map.html`, `OPPORTUNITIES.md`, and `claude_code_guide_handoff.txt`; plus conditional `hire_a_builder.md` from Stage 9.5 when the operator has no developer.
- Canonical Silver Platter stages: 0 audit, 0.5 AuditData intake, 1 speed, 2 archetype, 3 pantry, 4 existing automation, 5 data reality check, 6 assembly, 6.5 recipes, 6.6 setup priority, 6.7 interaction channel, 7 render, 8 opportunities, 9 handoff prompt, 9.5 developer-availability branch, and 10 confirmation.
- Official Telegram constraint: a menu-button Mini App does not directly write arbitrary text into the composer. Reliable choices are a server-side `answerWebAppQuery` flow using `query_id`, inline mode with explicit user selection, or a clipboard fallback. `sendData` is specifically documented for keyboard-button launches.
- Bridge status: `/home/apexaipc/projects/hermes-claude-bridge/STATUS.md` says the custom bridge is intentionally unfinished and inactive. The supported bridge is Hermes → Paperclip → native model adapter.
- M2AI accents verified from the current organization profile: cyan `#06B6D4`, teal `#14B8A6`, orange `#E85D04`. Existing accessible warm-white and ink neutrals remain until contrast tests approve replacements.

## Product boundaries

1. The opening surface remains an outcome-first list of cards.
2. A card is either `prompt` or `workflow`; render logic must not infer behavior from title/category strings.
3. Prompt-card delivery requires an explicit user action and visible confirmation. No silent send.
4. “Populate Telegram chat” must be implemented as one named transport contract:
   - recommended: send a confirmed message into the bot chat through server-side `answerWebAppQuery`;
   - alternative: return to inline mode and require the user to select the result;
   - browser/unsupported fallback: copy to clipboard and explain the limitation.
5. Silver Platter skill files, bot tokens, filesystem paths, Claude credentials, and execution authority never ship in JavaScript.
6. The browser wizard collects and validates answers; a server-side executor maps stable workflow ID `silver-platter` plus schema version to the canonical skill.
7. Consequential or external actions remain human-approved. Silver Platter itself produces drafts and handoff artifacts.

## Proposed schemas to freeze before implementation

```ts
type CardKind = "prompt" | "workflow";

type BaseCard = {
  id: string;
  kind: CardKind;
  title: string;
  description: string;
  category: string;
  tags: string[];
};

type PromptCard = BaseCard & {
  kind: "prompt";
  template: string;
  fields: PromptField[];
  action: {
    type: "prompt-delivery";
    requiresConfirmation: true;
    preferred: "telegram-webapp-query";
    fallback: "clipboard";
  };
};

type WorkflowCard = BaseCard & {
  kind: "workflow";
  workflow: {
    id: "silver-platter";
    schemaVersion: "1.0";
    entryStage: "1_speed";
  };
};

type SilverPlatterStageId =
  | "0_audit"
  | "0_5_audit_data"
  | "1_speed"
  | "2_archetype"
  | "3_pantry"
  | "4_existing_automation"
  | "5_data_reality"
  | "6_assemble"
  | "6_5_recipes"
  | "6_6_setup_priority"
  | "6_7_interaction_channel"
  | "7_render"
  | "8_opportunities"
  | "9_handoff"
  | "9_5_developer_availability"
  | "10_confirmation";

type WizardStatus = "draft" | "review" | "submitted" | "completed" | "blocked";

type SilverPlatterWizardState = {
  schemaVersion: "1.0";
  workflowId: "silver-platter";
  currentStage: SilverPlatterStageId;
  status: WizardStatus;
  answers: SilverPlatterInterviewAnswersV1;
  completedStages: SilverPlatterStageId[];
  updatedAt: string;
};

type SilverPlatterBrowserSubmissionV1 = {
  contract: "silver-platter-browser-submission/v1";
  workflowId: "silver-platter";
  schemaVersion: "1.0";
  answers: SilverPlatterInterviewAnswersV1;
};

type SilverPlatterServerContextV1 = {
  contract: "silver-platter-server-context/v1";
  workflowId: "silver-platter";
  normalizedInterview: {
    answers: SilverPlatterInterviewAnswersV1;
    completedStages: SilverPlatterStageId[];
  };
  stage0: {
    mode: "mini-app-interview";
    localWorkspaceAudited: false;
  };
  auditData?: {
    schema: "audit-data/v1";
    business_overview: unknown;
    workflow_analysis: unknown;
    data_infrastructure: unknown;
    ai_implementation: unknown;
    email?: string;
    timestamp?: string;
    sourceHash: string;
  };
};
```

`SilverPlatterInterviewAnswersV1` is not an open dictionary. Before Phase 4 persistence, it must become a runtime-validated object whose keys are the stable stage IDs above and whose values are the exact question IDs and answer types from the canonical skill. Exact validator choice is a Phase 1 decision; do not add a dependency without measuring bundle and maintenance cost.

The browser state and the skill's `--resume` mode are different layers. `SilverPlatterWizardState` resumes an unsubmitted interview locally, but `currentStage`, `status`, and `completedStages` are never accepted as executor authority. The browser may submit only `SilverPlatterBrowserSubmissionV1`, which contains validated answers; any client-supplied `audit`, `auditData`, completed-stage/skip marker, provenance value, filesystem path, or execution option is rejected. The server recomputes `normalizedInterview.completedStages` from the accepted answer schema. Optional Stage 0.5 AuditData is ingested through a separate server-controlled validation path, and the server computes its source hash. Only the server may construct `SilverPlatterServerContextV1`.

Prompt Pocket chooses a Mini App-specific Stage 0 boundary. A Telegram Mini App cannot inspect the operator's local project, so it must never claim that the executor's working directory represents the operator's setup. It does not use the canonical `audit-existing` branch or audit-derived skip markers. Instead it displays a plain-language limitation, asks the operator the relevant existing-setup questions as normal validated interview fields, and sets `stage0.mode` to `mini-app-interview`. Auditing an operator workspace is out of scope until a separately approved, user-authorized local adapter with an authenticated constrained result exists. Any executor-directory audit is limited to resume/artifact integrity and cannot alter operator questions.

The canonical skill documents `--resume` only for an existing full-v2 `silver_platter_output/data_map.json`; it does not provide a machine-readable schema or accept browser state directly. Prompt Pocket therefore owns a compatibility contract, not a canonical validator. The contract must live at `contracts/silver-platter-compatibility-v1.schema.json` with its field map at `contracts/silver-platter-compatibility-v1.md`. After submission, the executor validates the browser payload, combines it with the server-created Mini App context, materializes a compatibility-validated full-v2-shaped map, and only then invokes the documented `--resume` path in its own working directory. The browser never names or controls a filesystem path.

### Required handoff mapping before persistence

| Handoff source                                       | Canonical destination/behavior                             | Proof required                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `interview.answers.1_speed`                          | Interview mode and explanation depth                       | Saved answer survives import and is not re-asked.                                        |
| `interview.answers.2_archetype.business_description` | `business` description/how-money-is-made fields            | Exact user wording survives import.                                                      |
| `interview.answers.2_archetype.confirmed_archetype`  | Canonical business archetype                               | Runtime rejects unsupported slugs; accepted value is not re-asked.                       |
| Every later `interview.answers.<stage>.<questionId>` | Named full-v2 field or explicit interview checkpoint       | No anonymous keys; add one mapping row and fixture assertion before adding the question. |
| `stage0.mode = mini-app-interview`                   | Explicit product boundary, not operator-workspace evidence | No `audit-existing` skips; existing setup is asked and validated as interview answers.   |
| `auditData.business_overview`                        | Stage 2 archetype/sizing and opportunity framing           | Preserve source hash and confirm only ambiguity.                                         |
| `auditData.workflow_analysis.tasks[]`                | Stage 3 Pantry and Stage 6.5 recipe candidates             | Imported tasks are not re-entered manually.                                              |
| `auditData.data_infrastructure`                      | Stage 5 data-reality fields                                | Quality and willingness constraints survive import.                                      |
| `auditData.ai_implementation`                        | Stage 6.6 build constraints and Stage 8 framing            | Compliance, budget, preference, and interested tools survive import.                     |
| `auditData.email`, `timestamp`, `sourceHash`         | Report provenance only                                     | These values never alter authority or skip unrelated questions.                          |

The mapping table is executable scope, not documentation-only. Before Phase 4, replace every `unknown` placeholder with the authoritative AuditData types, commit the application-owned JSON Schema and field map, and generate `contracts/silver-platter-source-manifest.json` containing hashes for the canonical `SKILL.md`, renderer, archetype/question references, and selected worked examples that informed compatibility v1. A source-hash change invalidates the gate and requires contract review; a matching hash does not imply the skill published an official schema.

Phase 5 must include a disposable fixture that starts from saved Stage 1-2 browser state, uses the Mini App interview boundary, optionally ingests Stage 0.5 through the server validator, creates the executor-owned directory, materializes an application-contract-valid full-v2-shaped map, invokes the supported resume path, and proves answered questions are not asked again. Positive tests must cover an operator who reports existing local setup and one who reports none; both must produce interview-derived fields regardless of whether the executor directory is empty or contains server artifacts. A negative test must submit forged client `audit`, `auditData`, skip-marker, and provenance fields and prove they are rejected before context construction. Production execution authority still remains Phase 7.

## Phase table

| Phase | Outcome                                                   | Schema/status gate before work                                                                                                                                                                                                                                                                                                          | Required end-of-phase tests                                                                                                                                                                                                                                                                                                                                                                                                                | Independent review gate                                                                                                                 |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Reconnaissance and schema freeze                          | Clean Git status; live card schema read; Silver Platter stages/output schema read; Telegram delivery semantics verified; bridge status verified                                                                                                                                                                                         | `npx prettier --check .`; `npx tsc --noEmit`; `npm test`; `npm run lint`; `npm run build`; `npm audit`; final `git status --short --branch`                                                                                                                                                                                                                                                                                                | Reviewer checks that no unsupported Telegram claim, browser secret, or inactive custom bridge entered the plan                          |
| 1     | M2AI tokens plus discriminated card schema                | Re-fetch Git status and Phase 0 tracker; review exact schema diff; include replacement of `STACEY'S AI TOOLKIT` with approved M2AI copy; no implementation worker active                                                                                                                                                                | RED tests for prompt/workflow discrimination, approved M2AI copy, and palette token presence; GREEN targeted tests; full typecheck/test/lint/build/audit; no Git drift                                                                                                                                                                                                                                                                     | Paperclip-native reviewer compares diff to schema and M2AI palette                                                                      |
| 2     | Prompt-card action abstraction with safe browser fallback | Card schema version `1.0` validated; choose delivery wording; no bot token in client env                                                                                                                                                                                                                                                | RED then GREEN tests for confirmation, adapter invocation, unsupported-host clipboard fallback, errors, and no silent send; full gates                                                                                                                                                                                                                                                                                                     | Reviewer checks action semantics and HIL behavior                                                                                       |
| 3     | Telegram message-delivery backend                         | Live Telegram/Bot API method and request/response schemas reverified; backend hosting and secret source approved; server validates Telegram init data                                                                                                                                                                                   | Contract tests, invalid-signature negative test, expired init-data test, idempotency test, Telegram test-chat smoke, full client/server gates                                                                                                                                                                                                                                                                                              | Paperclip-native reviewer inspects authority surface, token confinement, idempotency, and proof from test chat                          |
| 4     | Workflow-card shell and resumable wizard engine           | Workflow schema `1.0`, browser submission v1, server context v1, application-owned JSON Schema/field map/source manifest, and persistence choice approved; migration behavior defined                                                                                                                                                   | RED then GREEN tests for workflow-card routing, stage navigation, required fields, resume, corrupt-state recovery, browser fallback, mobile keyboard                                                                                                                                                                                                                                                                                       | Reviewer checks state-machine, authority split, and compatibility-contract drift and confirms ordinary prompt cards still work          |
| 5     | Silver Platter vertical slice                             | Canonical skill source manifest and Stage 0-2 question/output contract reverified; Mini App-specific Stage 0 boundary accepted; application compatibility schema/field map frozen; browser receives only a sanitized interview schema                                                                                                   | Tests for card appearance, Stage 0 limitation copy, existing-setup interview paths with empty/nonempty executor directories, Walkthrough/Fast Track, business description, archetype confirmation, save/resume, back/close, schema rejection; forged-audit negative test; disposable partial-state → application-valid map → `--resume` fixture covers optional server-ingested Stage 0.5 without re-asking answered questions; full gates | Reviewer compares wizard wording, Stage 0 boundary, authority split, compatibility contract, and fixture with canonical skill Stage 0-2 |
| 6     | Full Silver Platter interview                             | Reverify all interview-stage schemas and conditional branches, including the Mini App Stage 0 interview variant, Stage 0.5 AuditData intake, recipes, setup priority, channels, regulated archetypes, and Stage 9.5 developer availability; canonical `audit-existing` remains explicitly unsupported without an approved local adapter | One vertical RED/GREEN cycle per stage; conditional-branch tests; complete/resume fixture; accessibility/mobile; full gates                                                                                                                                                                                                                                                                                                                | Reviewer checks omitted/re-asked questions, Stage 0 truthfulness, schema completeness, plain language, and regulated-data boundaries    |
| 7     | Server-side Silver Platter execution and artifacts        | Executor authority, working directory, output schema, timeout, budget, and HIL gates approved; skill remains server-side                                                                                                                                                                                                                | Fixture run produces four mandatory artifacts and conditional `hire_a_builder.md` when its branch fires; schema validation; timeout/retry/idempotency; no `.claude/` mutation; artifact readback and hashes                                                                                                                                                                                                                                | Paperclip-native reviewer returns `AGREE`, `MODIFY`, or `REJECT`; Hermes independently verifies artifacts and tests                     |
| 8     | Remaining video-feature card roadmap                      | Silver Platter card accepted and usage evidence reviewed                                                                                                                                                                                                                                                                                | Tests for each new card as an independent vertical slice                                                                                                                                                                                                                                                                                                                                                                                   | Independent review per slice                                                                                                            |
| 9     | Production release                                        | GitHub Pages/backend URLs, Telegram config, CSP, schema versions, and release marker verified live                                                                                                                                                                                                                                      | Formatter, typecheck, behavioral tests, lint, build, audit, secret scan, desktop/mobile browser smoke, HTTPS fetch, Telegram launch, real approved message flow                                                                                                                                                                                                                                                                            | Final drift review plus human approval before production switch                                                                         |

## Detailed phase execution

### Phase 0: Reconnaissance and freeze

**Files:**

- Create: `.hermes/plans/2026-09-01-prompt-pocket-silver-platter-blueprint.md`
- Create: `IMPLEMENTATION_TRACKER.md`
- Read only: `src/types.ts`, `src/prompts.ts`, `src/App.tsx`, tests, Telegram docs, Silver Platter skill/references, bridge status.

**Steps:**

1. Record exact Git commit/branch/dirty state.
2. Record current client schema and Telegram type surface.
3. Extract Silver Platter stages, output files, recipe schema, and non-negotiable rules.
4. Record Telegram delivery options without pretending a static Mini App can populate the composer directly.
5. Record M2AI color tokens and source.
6. Run mandatory baseline tests and record every failure separately from blockers.
7. Submit this plan to independent review. No production code changes.

**Exit:** Phase 1 may start only after the tracker names the accepted schema, formatter policy for generated `docs/`, and reviewer verdict.

### Phase 1: Card schema and M2AI foundation

**Likely files:**

- Modify: `src/types.ts`, `src/prompts.ts`, `src/styles.css`
- Create or modify tests: `src/prompt-utils.test.ts`, `src/App.test.tsx`
- Optional create: `src/card-schema.ts`, only if runtime validation is implemented without needless duplication.

Use strict RED → GREEN cycles: schema discrimination first, then rendering, approved M2AI brand copy, and tokens. Do not implement Telegram transport or wizard screens in this phase.

### Phase 2: Prompt action adapter

**Likely files:**

- Create: `src/telegram-actions.ts`
- Create: `src/telegram-actions.test.ts`
- Modify: `src/App.tsx`, `src/vite-env.d.ts`, `src/App.test.tsx`

Define an adapter interface with explicit confirmation and a browser fallback. No backend or bot token yet.

### Phase 3: Telegram backend

Host separately from static Pages. Validate Telegram-signed init data server-side. Build one harmless test-chat path before any general rollout. Do not use direct browser Bot API calls.

### Phase 4: Wizard engine

**Likely files:**

- Create: `src/workflows/types.ts`, `src/workflows/wizard-state.ts`, tests
- Create: `src/components/WorkflowWizard.tsx`, tests
- Modify: `src/App.tsx`

Implement generic stage navigation and persistence only. No Silver Platter-specific wording until the engine passes.

### Phase 5: Silver Platter card vertical slice

**Likely files:**

- Create: `src/workflows/silver-platter/schema.ts`
- Create: `src/workflows/silver-platter/stages.ts`
- Create: `src/workflows/silver-platter/*.test.ts`
- Modify: card data source and wizard routing.

Ship only Stage 1 speed selection and Stage 2 business description/archetype confirmation. Persist and resume in the browser. Also build the bounded, disposable importer fixture required above so this slice proves card → wizard → validated handoff → canonical full-v2 map → supported `--resume`, without granting the browser execution authority or shipping the production executor.

### Phases 6-9

Expand one Silver Platter stage at a time, then add the remaining cards shown in the video: Teaching, Research Capture, Approvals, Content Launches, and Role-specific Mini Apps. Each is a separate observed-use vertical slice, not a batch of decorative cards.

## Mandatory phase protocol

Before every phase:

1. Read `IMPLEMENTATION_TRACKER.md` and this plan.
2. Run `git status --short --branch` and record HEAD.
3. Re-read the exact schema and authoritative external documentation the phase depends on.
4. Verify no prior worker/review is still active.
5. Update tracker status to `gated` with the evidence paths.

During every implementation phase (Phases 1-9). Phase 0 is explicitly exempt because it is read-only reconnaissance and uses the baseline verification commands instead:

1. Write one failing behavioral test.
2. Run it and capture the expected failure.
3. Write the minimal implementation.
4. Run the targeted test to GREEN.
5. Refactor only while green.
6. Repeat vertically.

At every phase end:

1. Run formatter/check policy, typecheck, targeted tests, full tests, lint, build, audit, and secret scan when files could contain credentials.
2. Verify Git diff and generated `docs/` state.
3. Update tracker with exact commands/results, issues, blockers, decisions, artifacts, commit, and resume point.
4. Submit a read-only review packet through Hermes → Paperclip → native reviewer. The inactive custom bridge must not be activated.
5. Require `AGREE`, or resolve every `MODIFY`; stop on `REJECT`.
6. Hermes independently reruns the tests and inspects the diff before advancing.

## Risks and open decisions

- **Composer wording:** Telegram does not provide a generic direct-composer API for this menu-button flow. Decide whether “populate chat” means server-posted user message (`answerWebAppQuery`, recommended) or inline-mode draft selection.
- **Backend hosting:** GitHub Pages cannot protect bot credentials. Choose a bounded backend before Phase 3.
- **Wizard persistence:** choose localStorage, Telegram DeviceStorage, or server persistence after privacy/portability review.
- **Sensitive business data:** Silver Platter may collect operational details. Define retention and deletion before server persistence.
- **Formatter policy:** `prettier --check .` currently fails on generated `docs/` assets while all other gates pass. Decide whether to ignore generated output or enforce formatting before Phase 1.
- **Bridge terminology:** the custom bridge repo is inactive. The supported independent-review bridge is Paperclip’s native adapter.

## Done when

The Silver Platter workflow card is visible in the M2AI-branded card list, opens a resumable schema-validated wizard, completes the canonical interview without exposing secrets or local skill code, submits through an approved Telegram/server path, produces and verifies the four canonical artifacts, passes all phase tests and live Telegram checks, and carries an independent `AGREE` review plus human approval.
