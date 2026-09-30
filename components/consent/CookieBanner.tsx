"use client";

import { useCallback, useEffect, useState } from "react";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  clearAnalyticsCookies,
  readCookieConsent,
  saveCookieConsent,
  syncCookieConsentToServer,
} from "@/lib/cookie-consent";

/**
 * Баннер cookie для приложения. Читает и пишет тот же ключ, что лендинг
 * (nika_cookie_consent_v1). До выбора аналитика не грузится (см. AnalyticsGate).
 */
export function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = readCookieConsent();
    if (saved) {
      window.NIKA_CONSENT = saved;
      // Выбор, сделанный до входа (или на лендинге), один раз за сессию уходит в журнал
      try {
        if (!sessionStorage.getItem("nika_cookie_synced")) {
          sessionStorage.setItem("nika_cookie_synced", "1");
          void syncCookieConsentToServer(saved);
        }
      } catch {
        /* sessionStorage недоступен */
      }
    } else {
      setOpen(true);
    }
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  const choose = useCallback((analytics: boolean) => {
    const before = readCookieConsent();
    const c = saveCookieConsent(analytics);
    setOpen(false);
    void syncCookieConsentToServer(c);
    if (!analytics && before?.analytics) {
      // Метрика уже загружена в этой вкладке: чистим её cookie и перезагружаем без неё
      clearAnalyticsCookies();
      window.location.reload();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Файлы cookie"
      className="fixed inset-x-3 z-[90] mx-auto max-w-[440px] rounded-[18px] border border-line-default bg-elevated p-4 text-[13px] leading-[1.55] text-ink-secondary shadow-card"
      style={{ bottom: "calc(12px + env(safe-area-inset-bottom))" }}
    >
      <p>
        Мы используем cookie. Необходимые нужны для работы приложения, аналитические (Яндекс Метрика и Amplitude)
        включаем только с твоего согласия.{" "}
        <a href="/legal/privacy#cookie" target="_blank" rel="noopener" className="text-ink-primary underline underline-offset-2">
          Подробнее
        </a>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => choose(true)}
          className="min-h-[44px] flex-1 rounded-pill bg-ink-primary px-3 text-[14px] font-medium text-canvas transition-opacity hover:opacity-90"
        >
          Принять
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          className="min-h-[44px] flex-1 rounded-pill border border-line-default px-3 text-[14px] font-medium text-ink-primary transition-colors hover:bg-surface-nika"
        >
          Только необходимые
        </button>
      </div>
    </div>
  );
}
