---
title: Prompt Pocket Phase 0 independent drift review
owner: Hermes
sink: Paperclip issue comment with AGREE, MODIFY, or REJECT verdict; Prompt Pocket IMPLEMENTATION_TRACKER.md review ledger
kill: one Codex reviewer run; stop on any file mutation, external action, or missing structured verdict
lane: build
shape: one-shot
route: human-routed
---

## Goal

Independently review `/home/apexaipc/projects/products/quick-prompt-cards/.hermes/plans/2026-09-01-prompt-pocket-silver-platter-blueprint.md` and `/home/apexaipc/projects/products/quick-prompt-cards/IMPLEMENTATION_TRACKER.md` for drift from the verified Prompt Pocket code, canonical Silver Platter skill, official Telegram Mini App constraints, M2AI palette, phased TDD requirements, and browser/server authority boundary. This is critique only. Do not edit files, commit, push, deploy, publish, invoke other agents, or change issue hierarchy.

## Evidence contract

Post exactly one structured review comment containing:

- Verdict: AGREE, MODIFY, or REJECT
- Observations separated from assumptions
- Strongest reason the blueprint may be wrong
- Missing evidence
- Exact required corrections, or `None`
- Explicit confirmation that no repository files were changed
  Then move this review issue to `in_review` and stop. Do not leave it `in_progress`.

## Done when

The issue contains one reviewer comment with an `AGREE`, `MODIFY`, or `REJECT` verdict, observations separated from assumptions, the strongest reason the blueprint may be wrong, missing evidence, and exact required corrections; the reviewer has made zero repository changes and the issue is left in a non-waking review state.

## Action

Read the two named artifacts plus only the exact source files they cite, then post the structured drift verdict and stop.

## Why this shape

This is one bounded, read-only independent review with one reviewer and one evidence sink. It needs no recurring loop and no implementation authority.
