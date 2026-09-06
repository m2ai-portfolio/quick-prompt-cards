# Prompt Pocket

A mobile-first Telegram Mini App that helps people run useful prompts and shape guided automations without depending on a specific LLM provider.

## Features

- One useful starter prompt instead of a large canned library
- A focused **Create a prompt** composer with review-before-save
- Device-stored 📌 pinned personal prompts
- Device-local editing of a prompt card's category, name, and prompt
- Confirm-before-delete protection for editable prompt cards
- M2AI-branded app icons and explicit **GO** actions
- One-tap stored-prompt dispatch from a supported Telegram launch
- Explicit clipboard fallback outside Telegram
- Silver Pocket, a provider-neutral guided automation workflow
- Local save, close, and resume for guided workflows
- Lightweight search and category filters
- Telegram theme, expansion, and haptic hooks
- No model credential or bot token in browser code
- One shared pocket per Telegram user, synced across the approved bots (Phase 2)

## Local development

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm run format
npx tsc -b --noEmit
npm run typecheck:server
npm test
npm run lint
npm run build
npm audit
```

The production build is written to `docs/` for GitHub Pages.

- Repository: https://github.com/m2ai-portfolio/quick-prompt-cards
- Production site: https://m2ai-portfolio.github.io/quick-prompt-cards/

## Editing the library

The single canonical starter prompt lives in `shared/prompt-catalog.ts`. The client adds delivery metadata in `src/prompts.ts`, which also registers the **Create a prompt** and workflow cards. Personal prompts are assembled in `src/prompt-creator.ts`. In a synced launch, pins and starter-card edits become pocket records on the server (`shared/pocket-contract.ts`); otherwise they stay in local device storage as before.

Silver Pocket's guided questions live in `src/workflows/silver-pocket/definition.ts`. Keep them provider-neutral and ask only for information needed to define the automation.

## Workflow compatibility

Silver Pocket uses workflow ID `silver-pocket` and schema version `2.0`. It intentionally starts fresh instead of migrating Silver Platter drafts because the provider-specific answer model was replaced rather than renamed. Old browser-local records are not executed or uploaded.

## Syncing across bots

Open Prompt Pocket from one of the approved bots and your pinned prompts and starter-card edits live in one pocket tied to your Telegram account, so the same pocket appears whether you launch from Hermes1 or Beth, on any device. The launch URLs are `https://m2ai-portfolio.github.io/quick-prompt-cards/?bot=hermes1` and `https://m2ai-portfolio.github.io/quick-prompt-cards/?bot=beth`; the `bot` key only tells the server which bot validated your launch and which bot posts a prompt, it never changes where the app talks to. Opened any other way (a plain browser tab, a missing or malformed `?bot=`, or a server that cannot be reached) the app shows "Not synced: open from Hermes1 or Beth" and keeps working on this device only. The first synced launch on a device that already holds local pins or edits asks before uploading them, with the exact counts; nothing is uploaded until you tap Import, and local copies are kept until the server confirms every one. Edits go to the server first; if that fails you keep your text and get a "Couldn't sync, try again" prompt rather than a silent local copy. Tapping GO on a pinned or edited prompt sends your own words; an unedited starter card sends the canonical text.

Configuration: `VITE_PROMPT_POCKET_API_BASE` (v2 API base) and `VITE_PROMPT_RUN_ENDPOINT` (v1 rollback path) in `.env.production`; see `.env.example`. Both are public URLs; no token ever belongs in the browser bundle.

## Telegram setup

1. Create or select a bot with `@BotFather`.
2. Use **Bot Settings → Menu Button** or `/setmenubutton`.
3. Set the Mini App URL to the GitHub Pages deployment.
4. Open the bot in Telegram and tap its menu button.
