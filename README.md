# Prompt Pocket

A mobile-first Telegram Mini App that helps new AI users choose a task, add a few details, and copy a complete prompt.

## Features

- Searchable prompt cards
- Category filters
- Guided prompt customization
- Live finished-prompt preview
- One-tap copy
- Favorites stored on the device
- Telegram theme, expansion, and haptic hooks
- Standalone browser fallback

## Local development

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm run format
npx tsc --noEmit
npm test
npm run lint
npm run build
npm audit
```

The production build is written to `docs/` for GitHub Pages.

## Editing the library

Prompt cards live in `src/prompts.ts`. Each card defines its category, search tags, guided fields, and final prompt template.

## Telegram setup

1. Create or select a bot with `@BotFather`.
2. Use **Bot Settings → Menu Button** or `/setmenubutton`.
3. Set the Mini App URL to the GitHub Pages deployment.
4. Open the bot in Telegram and tap its menu button.
