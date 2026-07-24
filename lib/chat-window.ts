/**
 * Контекстное окно диалога: сколько истории реально уходит в Claude.
 *
 * Клиент присылает всю переписку целиком, а диалог живёт через дни и растёт
 * неограниченно. Раньше роут отвечал на длинную историю 400 — и тред, перевалив
 * за 50 реплик, ломался навсегда. Теперь история обрезается окном: в модель
 * уходит хвост, в БД по-прежнему пишется всё.
 */

export interface WindowMessage {
  role: "user" | "assistant";
  content: string;
}

/** Реплик в окне. Держит счёт за токены. */
export const CONTEXT_MAX_MESSAGES = 50;
/** Символов в окне. */
export const CONTEXT_MAX_CHARS = 24_000;

/**
 * Хвост истории для отправки в модель.
 *
 * Два инварианта:
 * 1. Окно начинается с реплики пользователя — Anthropic требует, чтобы первое
 *    сообщение было от user. Срез посередине мог бы начаться с ответа НИКИ.
 * 2. Последняя реплика не выбрасывается никогда, даже если одна превышает лимит
 *    символов: слишком длинную отсекает отдельный потолок по токенам
 *    (hard_cap_tokens) с понятным для клиента 413.
 */
export function contextWindow<T extends WindowMessage>(all: T[]): T[] {
  if (all.length === 0) return all;

  const lastIdx = all.length - 1;
  let start = Math.max(0, all.length - CONTEXT_MAX_MESSAGES);

  let chars = 0;
  for (let i = lastIdx; i >= start; i--) {
    chars += all[i].content.length;
    if (chars > CONTEXT_MAX_CHARS && i < lastIdx) {
      start = i + 1;
      break;
    }
  }

  while (start < lastIdx && all[start].role !== "user") start++;
  return all.slice(start);
}
