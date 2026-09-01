/// <reference types="vite/client" />

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme?: "light" | "dark";
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
