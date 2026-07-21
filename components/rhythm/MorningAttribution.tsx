"use client";

import { useEffect, useRef } from "react";

/**
 * Атрибуция открытия утреннего нуджа (раздел 11 ТЗ). Рендерит null — только
 * побочный эффект при заходе на экран чек-ина с ?src=tg_morning:
 *   • один раз (ref-гард, не на каждый ререндер) дёргает /api/notifications/opened
 *     — тот проставляет clicked_at и шлёт событие в Amplitude;
 *   • чистит query (history.replaceState), чтобы метка src не тянулась дальше.
 * Новой бизнес-логики чек-ина здесь нет.
 */
export function MorningAttribution() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("src") !== "tg_morning") return;
    done.current = true;

    // Атрибуция + событие — на сервере; аналитика не критична, ошибки глушим.
    void fetch("/api/notifications/opened", { method: "POST" }).catch(() => {});

    // Убираем src из URL, чтобы повторные заходы/шаринг не тянули метку.
    params.delete("src");
    const q = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
  }, []);

  return null;
}
