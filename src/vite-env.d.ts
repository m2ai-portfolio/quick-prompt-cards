/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Public (non-secret) base URL of the deployed prompt-run-v1 server
   * (contracts/prompt-run-v1.md). Never holds a credential: the bot token
   * lives only in the server's environment. Left unset means no server is
   * deployed yet, so one-tap dispatch is treated as unsupported.
   */
  readonly VITE_PROMPT_RUN_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type TelegramWebAppInitDataUnsafe = {
  query_id?: string;
  auth_date?: number;
  hash?: string;
  user?: {
    id: number;
    first_name: string;
    username?: string;
    language_code?: string;
  };
};

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme?: "light" | "dark";
  initData?: string;
  initDataUnsafe?: TelegramWebAppInitDataUnsafe;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
};

interface Window {
  Telegram?: {
    WebApp: TelegramWebApp;
  };
}
