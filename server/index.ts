import { createPromptRunServer } from "./http-server.js";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is required and must never be exposed to browser code.",
  );
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

createPromptRunServer(botToken).listen(port, () => {
  console.log(`prompt-run server listening on port ${port}`);
});
