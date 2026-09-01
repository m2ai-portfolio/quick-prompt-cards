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
  answers: Record<string, unknown>;
  completedStages: string[];
  updatedAt: string;
};
```

Runtime validation is required before loading persisted state or accepting server responses. Exact validator choice is a Phase 1 decision; do not add a dependency without measuring bundle and maintenance cost.

The browser state and the skill's `--resume` mode are different layers. Browser state resumes an unsubmitted interview. After server submission, the executor owns a server-side working directory and maps the validated state to `silver_platter_output/data_map.json`; only that executor may invoke the skill's `--resume` against that directory. The browser never names or controls a filesystem path.

## Phase table

| Phase | Outcome | Schema/status gate before work | Required end-of-phase tests | Independent review gate |
|---|---|---|---|---|
| 0 | Reconnaissance and schema freeze | Clean Git status; live card schema read; Silver Platter stages/output schema read; Telegram delivery semantics verified; bridge status verified | `npx prettier --check .`; `npx tsc --noEmit`; `npm test`; `npm run lint`; `npm run build`; `npm audit`; final `git status --short --branch` | Reviewer checks that no unsupported Telegram claim, browser secret, or inactive custom bridge entered the plan |
| 1 | M2AI tokens plus discriminated card schema | Re-fetch Git status and Phase 0 tracker; review exact schema diff; include replacement of `STACEY'S AI TOOLKIT` with approved M2AI copy; no implementation worker active | RED tests for prompt/workflow discrimination, approved M2AI copy, and palette token presence; GREEN targeted tests; full typecheck/test/lint/build/audit; no Git drift | Paperclip-native reviewer compares diff to schema and M2AI palette |
| 2 | Prompt-card action abstraction with safe browser fallback | Card schema version `1.0` validated; choose delivery wording; no bot token in client env | RED then GREEN tests for confirmation, adapter invocation, unsupported-host clipboard fallback, errors, and no silent send; full gates | Reviewer checks action semantics and HIL behavior |
| 3 | Telegram message-delivery backend | Live Telegram/Bot API method and request/response schemas reverified; backend hosting and secret source approved; server validates Telegram init data | Contract tests, invalid-signature negative test, expired init-data test, idempotency test, Telegram test-chat smoke, full client/server gates | Paperclip-native reviewer inspects authority surface, token confinement, idempotency, and proof from test chat |
| 4 | Workflow-card shell and resumable wizard engine | Workflow schema `1.0` and persistence choice approved; migration behavior defined | RED then GREEN tests for workflow-card routing, stage navigation, required fields, resume, corrupt-state recovery, browser fallback, mobile keyboard | Reviewer checks state-machine drift and confirms ordinary prompt cards still work |
| 5 | Silver Platter vertical slice | Canonical skill checksum/path and Stage 0-2 question/output contract reverified; browser receives only a sanitized schema | Tests for card appearance, Walkthrough/Fast Track, business description, archetype confirmation, save/resume, back/close, schema rejection; full gates | Reviewer compares wizard wording and transitions with canonical skill Stage 1-2 |
| 6 | Full Silver Platter interview | Reverify all stage schemas and conditional branches, including audit-existing, Stage 0.5 AuditData intake, recipes, setup priority, channels, regulated archetypes, and Stage 9.5 developer availability | One vertical RED/GREEN cycle per stage; conditional-branch tests; complete/resume fixture; accessibility/mobile; full gates | Reviewer checks omitted/re-asked questions, schema completeness, plain language, and regulated-data boundaries |
| 7 | Server-side Silver Platter execution and artifacts | Executor authority, working directory, output schema, timeout, budget, and HIL gates approved; skill remains server-side | Fixture run produces four mandatory artifacts and conditional `hire_a_builder.md` when its branch fires; schema validation; timeout/retry/idempotency; no `.claude/` mutation; artifact readback and hashes | Paperclip-native reviewer returns `AGREE`, `MODIFY`, or `REJECT`; Hermes independently verifies artifacts and tests |
| 8 | Remaining video-feature card roadmap | Silver Platter card accepted and usage evidence reviewed | Tests for each new card as an independent vertical slice | Independent review per slice |
| 9 | Production release | GitHub Pages/backend URLs, Telegram config, CSP, schema versions, and release marker verified live | Formatter, typecheck, behavioral tests, lint, build, audit, secret scan, desktop/mobile browser smoke, HTTPS fetch, Telegram launch, real approved message flow | Final drift review plus human approval before production switch |

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

Ship only Stage 1 speed selection and Stage 2 business description/archetype confirmation. Persist and resume. This proves the full card → wizard → validated state path without attempting the whole interview.

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
