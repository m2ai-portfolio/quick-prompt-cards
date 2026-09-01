# Prompt Pocket Implementation Tracker

This is a recovery ledger and phase evidence table, not the work queue. Paperclip remains the work system of record once implementation issues are created.

## Resume protocol

1. Read this file and `.hermes/plans/2026-09-01-prompt-pocket-silver-platter-blueprint.md`.
2. Verify live Git state. Never trust the recorded commit without rereading it.
3. Resume only the first row whose status is `gated` or `in_progress`.
4. Reverify that phase’s schema, authoritative docs, test commands, and bridge status before editing.
5. Check for an active worker/reviewer. Do not launch a duplicate.
6. Run the phase tests, update this table, then request independent review.
7. Never advance on an unresolved `MODIFY`, any `REJECT`, or a failed mandatory test.

## Current verified status

| Field | Live value | Evidence |
|---|---|---|
| Repository | `/home/apexaipc/projects/products/quick-prompt-cards` | live filesystem inspection |
| Branch/HEAD at Phase 0 start | `main`, `d2f3c8c` | `git status`, `git log -1` |
| Git status at Phase 0 start/end | clean and synchronized with `origin/main` | `git status --short --branch` |
| Existing card model | one `PromptCard` shape; no `kind` or workflow state | `src/types.ts` |
| Existing action | clipboard copy only | `src/App.tsx` |
| Existing deployment | static Vite build in `docs/` for GitHub Pages | `vite.config.ts`, build output |
| Silver Platter source | `/home/apexaipc/.claude/skills/silver-platter` | `SKILL.md` and references read |
| Silver Platter canonical outputs | `data_map.json`, `data_map.html`, `OPPORTUNITIES.md`, `claude_code_guide_handoff.txt` | `SKILL.md` |
| Telegram delivery truth | menu-button flow needs backend `answerWebAppQuery` for a posted user message; inline mode requires user selection; browser fallback can copy | official Telegram Mini Apps docs |
| Custom bridge | inactive and intentionally unfinished | `projects/hermes-claude-bridge/STATUS.md`; no service/process |
| Supported review bridge | Hermes → Paperclip → native adapter | Paperclip routing reference |
| M2AI accents | `#06B6D4`, `#14B8A6`, `#E85D04` | current M2AI GitHub org profile badges |

## Phase tracking

| Phase | Status | Schema/status gate | Steps taken | Mandatory tests | Issues/blockers | Artifacts/commit | Next resume point |
|---|---|---|---|---|---|---|---|
| 0. Recon and freeze | blocked | Repo/card/Silver Platter/Telegram/bridge schemas verified. Independent review still pending. | Read live code and skill sources; verified official Telegram semantics; recorded M2AI tokens; created blueprint/tracker. | `npx prettier --check .` FAIL on generated `docs/index.html` and minified `docs/assets/*`; `npx tsc --noEmit` PASS; `npm test` PASS 2 files/4 tests; `npm run lint` PASS; `npm run build` PASS; `npm audit` PASS 0 vulnerabilities; Git remained clean. | B-001 generated `docs/` formatting policy unresolved. B-002 custom bridge cannot be used because it is intentionally inactive; use Paperclip native adapter. B-003 exact Telegram “populate” UX decision unresolved. Independent drift review not yet completed. | Plan and this tracker; no app-code commit. | Resolve B-001 and B-003, run Paperclip-native review, then mark Phase 0 complete. |
| 1. M2AI tokens and card union | pending | Requires Phase 0 `AGREE` review and approved `Card` schema v1.0. | None. | RED/GREEN schema/render/token tests plus full gates. | Not started. | None. | Write the first failing card-kind test only. |
| 2. Prompt action adapter | pending | Requires card schema v1.0 and selected user-facing delivery wording. | None. | Confirmation, adapter, error, fallback, and no-silent-send tests plus full gates. | Not started. | None. | Define wished-for adapter API in a failing test. |
| 3. Telegram backend | pending | Requires approved host, live API schema recheck, init-data validation design, secret source. | None. | Contract and negative security tests, idempotency, test-chat smoke, full gates. | Static Pages cannot hold bot credentials. | None. | Choose backend and message semantics. |
| 4. Wizard engine | pending | Requires workflow schema/persistence decision. | None. | Navigation, validation, resume, corruption recovery, browser fallback, mobile tests. | Not started. | None. | Write failing wizard-state transition test. |
| 5. Silver Platter slice | pending | Requires canonical Stage 1-2 schema checksum/readback. | None. | Card → speed → business → archetype → save/resume tests plus full gates. | Not started. | None. | Add Silver Platter card only after wizard engine passes. |
| 6. Full Silver Platter | pending | Requires stage-by-stage canonical schema recheck. | None. | Vertical tests per stage and conditional branch fixtures. | Not started. | None. | Add one stage per cycle. |
| 7. Execution/artifacts | pending | Requires approved executor authority/HIL/timeout/output schema. | None. | Four-artifact fixture, hashes/readback, timeout/idempotency, no `.claude/` mutation. | Not started. | None. | Build server-side workflow mapping, never browser import. |
| 8. Video-feature cards | pending | Requires accepted Silver Platter vertical slice and observed-use review. | None. | One independent vertical test set per card. | Teaching, Research Capture, Approvals, Content Launches, Role-specific Mini Apps remain unimplemented. | None. | Prioritize one card from actual use. |
| 9. Production release | pending | Requires all prior gates and human approval. | None. | Full release gates, secret scan, HTTPS, browser/mobile, Telegram E2E. | Not started. | None. | Create release candidate only after review. |

## Issue and blocker ledger

| ID | Type | Status | Description | Resolution/next action |
|---|---|---|---|---|
| B-001 | Test/tooling | open | Prettier checks generated Vite output in `docs/`, then fails because the build emits minified assets. | In Phase 1 gate, decide and test a `.prettierignore` policy for generated output or a deterministic format/build sequence. Do not hide source formatting failures. |
| B-002 | Review route | constrained | The named custom Hermes-Claude bridge is explicitly inactive and must not be activated without a failed native-adapter acceptance test and Matt’s decision. | Use the functional Paperclip native adapter for independent review. Record verdict and issue ID here. |
| B-003 | Product/API semantics | decision needed | “Populate Telegram chat” is ambiguous. Menu-button Mini Apps cannot directly write arbitrary text into the compose box. | Choose server-posted user message via `answerWebAppQuery` (recommended), inline-mode selection, or clipboard fallback only. |
| B-004 | Architecture | open | Static GitHub Pages cannot securely execute Silver Platter or hold bot tokens. | Choose a minimal server-side adapter before Phase 3. |
| B-005 | Privacy | open | Silver Platter collects business operations and may include sensitive data. | Define storage, retention, deletion, and whether state stays only on-device before server persistence. |
| I-001 | Subagent | failed | Initial tracker subagent wrote only a partial artifact and stalled before creating project files. | Parent stopped it and completed the durable artifacts inline. Future phase tracker subagents must write incrementally, receive a 5-minute no-growth kill, and be independently verified. |

## Independent review ledger

| Review | Route | Scope | Verdict | Findings resolved | Evidence |
|---|---|---|---|---|---|
| R-000 | Pending Paperclip native adapter | Phase 0 blueprint/schema/Telegram/bridge drift | pending | pending | Add Paperclip issue/document/revision after readback. |

## Handoff snapshot

- No Prompt Pocket production code has been changed in this planning phase.
- The repository remained clean after baseline build/tests.
- Phase 0 is intentionally blocked, not complete, until the formatter policy, Telegram delivery semantics, and independent review are resolved.
- The next safe action is a read-only independent review of the blueprint, followed by the three explicit Phase 0 decisions. Do not start Phase 1 before those are recorded.
