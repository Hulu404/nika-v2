/**
 * Тонкий безопасный слой трекинга событий. Провайдер (PostHog/аналог) пока не
 * подключён — события уходят в безопасный сток (в dev — в консоль), провайдер
 * добавляется здесь одной точкой.
 *
 * ВАЖНО (приватность, бриф §9/§11): сюда НИКОГДА не передаётся сырой текст
 * состояния (свободная заметка daily_state.note). Разрешены только структурные
 * значения — канонические ключи чипов, бакеты, агрегаты, флаги.
 */
export type EventProps = Record<string, string | number | boolean | readonly string[]>;

export function track(event: string, props?: EventProps): void {
  if (typeof window === "undefined") return;

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[track]", event, props ?? {});
  }

  // TODO(analytics): отправка в провайдера, когда он появится в проекте.
}
