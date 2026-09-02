---
title: Prompt Pocket v2 — tap-to-run prompts and guided automations
owner: Hermes
sink: Paperclip Prompt Pocket project with verified prompt and automation vertical slices deployed to the Telegram Mini App
kill: stop if one-tap Telegram posting is unsupported for the actual menu-button launch, if any credential enters browser code, or if work regresses to form-fill-and-copy prompt cards
lane: build
shape: parent-with-atomic-children
route: compound-engineering
project: prompt-pocket
done_when: A Telegram user can tap a stored prompt card once and see it posted and run in the bot chat, or tap an automation card and enter a resumable guided workflow; both paths pass CE QA and code review
---

# Goal

Turn Prompt Pocket into two clear card experiences:

- `Prompt card → tap → run stored prompt in Telegram`
- `Automation card → tap → open guided workflow`

Silver Platter is the first automation card. It helps the user identify an automation opportunity, shape it, and name the resulting automation draft.

This file is intake evidence. Paperclip is the execution system of record.

## Settled product contract

1. A prompt card contains a complete stored prompt.
2. Prompt cards do not show fill-in fields, a prompt builder, a preview step, `Copy finished prompt`, or manual paste instructions.
3. The clearly labeled card tap is the explicit user action. Do not add a redundant second confirmation.
   This explicitly supersedes tracker decision B-003's separate confirmation step based on Matt's 2026-09-02 clarification. Hermes, not a child worker, updates the tracker at integration.
4. In a supported Telegram launch, tapping a prompt card sends only `{ cardId, initData }` to a trusted server. The server validates Telegram init data, resolves the canonical stored prompt by ID, and uses the supported Telegram Web App query flow to post the prompt as a user-authorized chat message. The existing bot handles the posted message normally; the new adapter does not invoke a second LLM.
5. Prompt Pocket never claims to insert unsent text into Telegram's composer.
6. Outside Telegram, an explicit clipboard fallback may be offered with an explanation. It is not the primary Telegram experience.
7. An automation card opens a guided workflow inside Prompt Pocket.
8. Silver Platter's first slice is small but real: choose pace, describe the business/work, identify the hardest recurring task, confirm the automation shape, name it, save it, close it, and resume it.
9. Bot tokens, credentials, local skill paths, filesystem authority, and server execution authority never ship in browser JavaScript.
10. Existing prompt cards remain but are rewritten as complete prompts that can ask the user for missing context conversationally after they run.

## Compound Engineering operating model

Installed plugin: `compound-engineering@compound-engineering-plugin` v3.24.0, enabled for both Claude Code and Codex CLI.

The current plugin exposes 33 skills and zero standalone top-level agents. Specialist agent behavior lives inside the skills. Use this chain:

- Requirements/orchestration: `ce-brainstorm` → `ce-plan`
- Isolated implementation: `ce-worktree` → `ce-work`
- Browser QA: `ce-test-browser` and, for exploratory Telegram UX, `ce-dogfood`
- Code review: `ce-code-review` in report-only mode, followed by explicit local resolution
- Learning closure: `ce-compound`

All mutating model work runs through Paperclip native adapters. Direct Claude/Codex calls remain read-only. Hermes owns integration, authoritative verification, and commits. No agent merges or deploys without the release gate.

## Atomic issue graph

```text
A1 capability + contract
└── A2 stored-prompt catalog and tap UI
    ├── A3 secure Telegram posting adapter
    │   └── A4 prompt tap-to-run integration
    └── A5 generic workflow shell
        └── A6 Silver Platter first slice

A4 + A6 → A7 integrated QA, review, and release
```

### A1 — Verify Telegram launch capability and freeze contracts

- Observable outcome: The actual Prompt Pocket menu-button launch records whether validated init data includes a usable Web App query ID. The prompt-run request/response contract and automation-state contract are written without implementing either feature.
- Owner: CE planner through a Paperclip-native Claude adapter; Hermes verifies.
- Sink: `contracts/prompt-run-v1.md`, `contracts/automation-state-v1.md`, and an issue comment containing redacted device evidence.
- Kill: If the real menu-button launch does not provide the supported one-tap query mechanism, stop. Present supported alternatives and their tap counts; do not silently substitute composer insertion, clipboard, or a second-tap flow.
- blockedBy: none; can start immediately because it is the capability gate for every implementation issue.
- Done when: The contracts name request fields, validation rules, outcomes, idempotency key, single-use query and retry boundaries, error behavior, fallback boundary, storage boundary, and exact evidence from the real Telegram launch. No token or raw init data is persisted in the evidence.
- Path allowlist: `contracts/**`, `src/vite-env.d.ts`.
- CE route: `ce-brainstorm` then `ce-plan`; no implementation skill.

### A2 — Convert the catalog to stored prompts and one-tap card dispatch

- Observable outcome: All existing prompt cards contain complete runnable prompts. The opening surface exposes one injected `runPrompt(cardId)` action. Prompt cards have no form fields, template placeholders, drawer builder, preview, copy button, or paste instructions.
- Owner: CE implementation worker in an isolated worktree; Hermes verifies.
- Sink: tested source change and issue evidence comment.
- Kill: If a card cannot become a complete stored prompt without losing its purpose, list the card ID and stop that card; never restore fill-in fields globally.
- blockedBy: A1.
- Done when: Tests prove one tap invokes `runPrompt` once with the card ID; all prompt IDs are unique; no stored prompt contains `{{`; Telegram-mode UI contains no prompt fields or `Copy finished prompt`; plain-browser fallback is explicit and separate. Format, typecheck, targeted tests, full tests, lint, build, audit, and secret scan pass.
- Path allowlist: `src/types.ts`, `src/prompts.ts`, `src/prompt-utils.ts`, `src/App.tsx`, `src/telegram-actions.ts`, `src/styles.css`, related tests, and `shared/prompt-catalog.ts`. The shared catalog is the canonical server-readable card ID/prompt source created here.
- CE route: `ce-worktree` → `ce-work` with strict test-first vertical slices.

### A3 — Build the secure Telegram prompt-posting adapter

- Observable outcome: A separately hosted TypeScript endpoint validates Telegram init data, rejects stale/forged input, resolves `cardId` against the canonical server-side catalog, and posts the stored prompt through Telegram's supported Web App query method. The browser never receives a bot token.
- Owner: CE backend/security implementation worker in an isolated worktree; Hermes verifies.
- Sink: `server/**`, contract tests, deployment decision record, and issue evidence comment.
- Kill: Stop on any design requiring a bot token or privileged credential in `VITE_*`, `docs/`, or browser source; stop if A1 disproves one-tap query support.
- blockedBy: A1 and A2. A2 must land the canonical shared catalog before server implementation begins.
- Done when: Tests cover valid input, bad signature, stale `auth_date`, unknown card, duplicate query ID/idempotency, Telegram failure, bounded timeout, and safe error responses. A Web App query ID is single-use: the client never replays one. Server retries are allowed only before Telegram accepts the single answer call and only for transport-safe failures; an ambiguous or accepted call is not replayed. A failed client flow tells the user to reopen Prompt Pocket for a new query. Built browser assets contain no secret or privileged endpoint behavior. No second LLM invocation is added.
- Path allowlist: `server/**`, `contracts/**`, `package.json`, lockfile, and server tests. `shared/prompt-catalog.ts` is read-only input owned by A2.
- CE route: `ce-worktree` → `ce-work`; later `ce-code-review` with security lenses.

### A4 — Integrate and prove prompt card tap-to-run

- Observable outcome: In Telegram, one tap on a prompt card posts the stored prompt into the bot chat and the existing bot processes it. Outside Telegram, the user receives the approved explicit fallback.
- Owner: CE integration worker; Hermes controls the live test; Matt approves any consequential production send/deploy.
- Sink: integrated client/server change, test-chat evidence, and issue comment with redacted request/result correlation.
- Kill: Stop if the path adds a second confirmation, asks the user to paste, attempts composer mutation, silently falls back inside Telegram, or causes duplicate posting.
- blockedBy: A2 and A3.
- Done when: Client tests cover supported and unsupported launch contexts, timeout, duplicate-tap suppression, and the single-use query boundary. The client does not retry a used or ambiguous query ID; it surfaces the failure and requires a fresh Mini App launch. A designated Telegram test-chat smoke shows one card tap, one posted user-authorized prompt, and one normal bot response. No secret appears in browser assets.
- Path allowlist: `src/telegram-actions.ts`, `src/vite-env.d.ts`, related tests, and `server/**` integration seams. A2 owns the `src/App.tsx` runPrompt wiring; A4 verifies it without editing that file.
- CE route: `ce-work`; QA later owned by A7.

### A5 — Build the generic guided-workflow shell and local resume

- Observable outcome: Automation cards use `openWorkflow(workflowId)`. A generic accessible wizard supports next, back, validation, save, close, resume, and corrupt-state recovery without Silver Platter-specific business logic.
- Owner: CE frontend implementation worker in an isolated worktree; Hermes verifies.
- Sink: workflow engine/components, tests, and issue evidence comment.
- Kill: Stop if persistence requires server-side business-data storage before retention/deletion policy is approved, or if generic code begins executing the local Silver Platter skill.
- blockedBy: A2, because A2 establishes the final card dispatch surface and removes the prompt drawer.
- Done when: Tests prove navigation, required-field blocking, versioned local persistence, resume, reset after corrupt/incompatible state, keyboard operation, and mobile-safe focus behavior.
- Path allowlist: `src/workflows/types.ts`, `src/workflows/wizard-state.ts`, `src/components/WorkflowWizard.tsx`, related tests, `src/App.tsx` routing seam, and `src/styles.css`.
- CE route: `ce-worktree` → `ce-work` with strict TDD.

### A6 — Ship Silver Platter as the first automation card

- Observable outcome: A visible Silver Platter automation card opens the guided workflow. The user chooses pace, describes the business/work, identifies the hardest recurring task, confirms the automation shape, names the automation, saves, closes, and resumes. The resulting named automation draft is visible on return.
- Owner: CE workflow implementation worker in an isolated worktree; Hermes verifies canonical alignment.
- Sink: Silver Platter workflow schema/content, tests, browser evidence, and issue comment.
- Kill: Stop if the slice invents questions that conflict with the canonical Silver Platter source, claims a local workspace audit occurred, executes the skill, or stores business answers on a server without an approved policy.
- blockedBy: A5.
- Done when: Tests cover the complete first slice, validation, back/close, local save/resume, name display, incompatible-state recovery, and no executor authority. Browser QA shows the full mobile flow.
- Path allowlist: `src/workflows/silver-platter/**`, `src/prompts.ts` for the Silver Platter card record, and related tests. A5 owns the generic routing seam and shared wizard styles; A6 consumes them without editing them.
- CE route: `ce-worktree` → `ce-work` → `ce-test-browser`.

### A7 — Integrated QA, adversarial review, and production release

- Observable outcome: Both product promises pass automated and real-device checks, all material review findings are resolved, and the approved build is deployed to the existing GitHub Pages Mini App plus the approved server host.
- Owner: Hermes orchestrates. Browser QA runs through a Paperclip-native Claude adapter that did not implement the reviewed unit. Adversarial code review runs through the Paperclip-native Codex adapter with Compound Engineering v3.24.0 installed and enabled. Matt owns the production HIL gate.
- Sink: QA report, code-review report, resolved-finding ledger, release commit/PR, production URL, Telegram menu-button readback, and Paperclip completion evidence.
- Kill: Do not release on any unresolved high-confidence finding, secret scan hit, duplicate message, inaccessible workflow, stale generated assets, or failed real-device path.
- blockedBy: A4 and A6.
- Done when: `ce-test-browser` covers all changed browser routes; `ce-dogfood` covers the Telegram experience; `ce-code-review` returns no unresolved material finding; full format/type/test/lint/build/audit/secret gates pass; production assets match the release SHA; Telegram menu-button URL is read back; Matt approves the exact release candidate.
- Path allowlist: read-only whole repository for QA/review; fixes are separately allowlisted per finding; generated `docs/**` only through build; release metadata and tracker.
- CE route: `ce-test-browser` → `ce-dogfood` → `ce-code-review` → explicit fixes → re-review → `ce-compound` → release.

## Release acceptance

The goal is complete only when both are true on a real Telegram client:

1. `Prompt card → one tap → stored prompt appears as a user-authorized message → existing bot handles it.`
2. `Automation card → one tap → guided workflow opens → progress saves and resumes.`

Planning artifacts, schemas, tests, and deployed headers are not substitutes for these observable outcomes.
