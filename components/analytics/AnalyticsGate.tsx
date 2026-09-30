"use client";

import { useEffect, useState } from "react";
import { CONSENT_EVENT, readCookieConsent, type CookieConsent } from "@/lib/cookie-consent";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";

/**
 * Загружает счётчики только при analytics === true в nika_cookie_consent_v1.
 * До выбора и после отказа не делается ни одного запроса к mc.yandex.ru:
 * YandexMetrika даже не монтируется.
 */
export function AnalyticsGate({ nonce }: { nonce?: string }) {
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setAnalytics(readCookieConsent()?.analytics === true);
    const onConsent = (e: Event) => setAnalytics((e as CustomEvent<CookieConsent>).detail?.analytics === true);
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);

  return analytics ? <YandexMetrika nonce={nonce} /> : null;
}
