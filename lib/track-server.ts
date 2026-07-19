/**
 * Серверный трекинг событий (бот/крон/роуты) — аналог клиентского lib/track.ts.
 * Провайдер — Amplitude через HTTP API (без SDK). Включается ТОЛЬКО если задан
 * AMPLITUDE_API_KEY; иначе безопасный сток (в dev — консоль), как клиентский стаб.
 *
 * ПРИВАТНОСТЬ (152-ФЗ, §13): в props НЕ кладём PII (email, имя, тексты сообщений,
 * токены, chat_id). user_id — внутренний UUID Supabase (идентификатор, не свойство).
 * Разрешены только структурные значения: enum ответа, причина отвязки, канал.
 * Изолирован: сетевые/иные ошибки не ломают вызывающий поток (fire-and-forget).
 */
export type ServerEventProps = Record<string, string | number | boolean>;

export function trackServer(userId: string, event: string, props?: ServerEventProps): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[track:server]", event, { user_id: userId, ...(props ?? {}) });
  }

  const key = process.env.AMPLITUDE_API_KEY;
  if (!key) return; // провайдер не настроен → no-op

  void fetch("https://api2.amplitude.com/2/httpapi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      events: [{ user_id: userId, event_type: event, event_properties: props ?? {} }],
    }),
  }).catch(() => {
    /* аналитика не критична */
  });
}
