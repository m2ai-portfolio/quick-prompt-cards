# Prompt Pocket

A mobile-first Telegram Mini App that helps people run useful prompts and shape guided automations without depending on a specific LLM provider.

## Features

- Searchable, outcome-focused prompt cards
- One-tap stored-prompt dispatch from a supported Telegram launch
- Explicit clipboard fallback outside Telegram
- Silver Pocket, a provider-neutral guided automation workflow
- Local save, close, and resume for guided workflows
- Category filters and device-stored favorites
- Telegram theme, expansion, and haptic hooks
- No model credential or bot token in browser code

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

Canonical stored prompts live in `shared/prompt-catalog.ts`. The client adds delivery metadata in `src/prompts.ts`, which also registers workflow cards.

Silver Pocket's guided questions live in `src/workflows/silver-pocket/definition.ts`. Keep them provider-neutral and ask only for information needed to define the automation.

## Workflow compatibility

Silver Pocket uses workflow ID `silver-pocket` and schema version `2.0`. It intentionally starts fresh instead of migrating Silver Platter drafts because the provider-specific answer model was replaced rather than renamed. Old browser-local records are not executed or uploaded.

## Telegram setup

1. Create or select a bot with `@BotFather`.
2. Use **Bot Settings → Menu Button** or `/setmenubutton`.
3. Set the Mini App URL to the GitHub Pages deployment.
4. Open the bot in Telegram and tap its menu button.
