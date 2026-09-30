/**
 * Выбор по cookie. Формат и ключ общие с лендингом (public/landing.html), поэтому
 * выбор, сделанный там, действует и в приложении, и наоборот.
 * Значение: { necessary: true, analytics: boolean, date: ISO, version: number }.
 * При выборе генерируется window-событие 'nika:consent' с этим объектом в detail.
 */
import { createClientComponentClient } from "@/lib/supabase";

export const COOKIE_CONSENT_KEY = "nika_cookie_consent_v1";
export const CONSENT_EVENT = "nika:consent";
export const OPEN_COOKIE_SETTINGS_EVENT = "nika:open-cookie-settings";
export const COOKIE_BANNER_VERSION = 1;

export interface CookieConsent {
  necessary: true;
  analytics: boolean;
  date: string;
  version: number;
}

declare global {
  interface Window {
    NIKA_CONSENT?: CookieConsent;
  }
}

export function readCookieConsent(): CookieConsent | null {
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CookieConsent> | null;
    if (!c || typeof c.analytics !== "boolean") return null;
    return {
      necessary: true,
      analytics: c.analytics,
      date: typeof c.date === "string" ? c.date : "",
      version: typeof c.version === "number" ? c.version : COOKIE_BANNER_VERSION,
    };
  } catch {
    return null;
  }
}

export function saveCookieConsent(analytics: boolean): CookieConsent {
  const c: CookieConsent = {
    necessary: true,
    analytics,
    date: new Date().toISOString(),
    version: COOKIE_BANNER_VERSION,
  };
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(c));
  } catch {
    // приватный режим: выбор действует до закрытия вкладки через window.NIKA_CONSENT
  }
  window.NIKA_CONSENT = c;
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }));
  } catch {
    /* старые браузеры без CustomEvent-конструктора */
  }
  return c;
}

/** Удаляет cookie Яндекс Метрики, которые она успела поставить до отказа. */
export function clearAnalyticsCookies(): void {
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = new Set<string>([host]);
  for (let i = 0; i < parts.length - 1; i++) domains.add("." + parts.slice(i).join("."));
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (!name || !(name.startsWith("_ym") || name === "yabs-sid" || name.startsWith("_ga"))) continue;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    domains.forEach((d) => {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${d}`;
    });
  }
}

/** Фиксирует выбор в журнале согласий для вошедшего пользователя. Без входа молча выходит. */
export async function syncCookieConsentToServer(c: CookieConsent): Promise<void> {
  try {
    // Гостю журналировать некуда (и 401 в консоли ни к чему): выбор живёт в localStorage
    const { data } = await createClientComponentClient().auth.getSession();
    if (!data.session) return;
    await fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        entries: [{ type: "cookies_analytics", granted: c.analytics }],
        source: "cookie_banner",
      }),
    });
  } catch {
    /* аналитика и журнал не должны мешать интерфейсу */
  }
}
