import type { NotifPermission } from "@/types/app";

/** Системный запрос разрешения на уведомления. Безопасно вне браузера/без API. */
export async function requestNotifPermission(): Promise<NotifPermission> {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      return (await Notification.requestPermission()) as NotifPermission;
    }
  } catch {
    /* игнорируем — вернём 'default' */
  }
  return "default";
}

/** Текущее разрешение без запроса диалога. */
export function currentNotifPermission(): NotifPermission {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission as NotifPermission;
    }
  } catch {
    /* нет API */
  }
  return "default";
}

/** Пытается показать настоящее ОС-уведомление (только при granted). */
export function tryOsNotification(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* уведомление не критично */
  }
}
