/// <reference types="vite/client" />

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
