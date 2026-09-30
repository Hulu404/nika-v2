/**
 * Серверный трекинг событий (бот/крон/роуты) — аналог клиентского lib/track.ts.
 * Провайдер — Amplitude через HTTP API (без SDK). Включается ТОЛЬКО если задан
 * AMPLITUDE_API_KEY и только для пользователей с согласием cookies_analytics;
 * иначе безопасный сток (в dev — консоль), как клиентский стаб.
 *
 * ПРИВАТНОСТЬ (152-ФЗ, §13): в props НЕ кладём PII (email, имя, тексты сообщений,
 * токены, chat_id). user_id — внутренний UUID Supabase (идентификатор, не свойство).
 * Разрешены только структурные значения: enum ответа, причина отвязки, канал.
 * Изолирован: сетевые/иные ошибки не ломают вызывающий поток (fire-and-forget).
 */
import { createServiceRoleClient } from "@/lib/supabase-server";

export type ServerEventProps = Record<string, string | number | boolean>;

export function trackServer(userId: string, event: string, props?: ServerEventProps): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[track:server]", event, { user_id: userId, ...(props ?? {}) });
  }

  const key = process.env.AMPLITUDE_API_KEY;
  if (!key) return; // провайдер не настроен → no-op

  // Amplitude это аналитика: отправляем только если пользователь согласился на аналитические
  // cookie (последняя запись cookies_analytics в журнале consents). Нет записи: не шлём.
  void (async () => {
    try {
      const { data } = await createServiceRoleClient()
        .from("consents")
        .select("granted")
        .eq("user_id", userId)
        .eq("type", "cookies_analytics")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.granted !== true) return;
      await fetch("https://api2.amplitude.com/2/httpapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          events: [{ user_id: userId, event_type: event, event_properties: props ?? {} }],
        }),
      });
    } catch {
      /* аналитика не критична */
    }
  })();
}
