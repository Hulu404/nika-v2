import { InlineKeyboard } from "grammy";

/**
 * Единая кнопка перехода на сайт для бот-сообщений. Роль бота — уведомления,
 * поэтому «перейти на сайт» вынесено в одно место и переиспользуется чек-инами,
 * рекомендациями, пуш-дублями и онбордингом.
 *
 * Базовый URL — NEXT_PUBLIC_APP_URL. Без него кнопки нет (undefined → grammy
 * просто не покажет клавиатуру), сообщение всё равно уходит.
 */
export function siteUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  return url ? url.replace(/\/$/, "") : null;
}

export function siteKeyboard(label = "Открыть НИКУ"): InlineKeyboard | undefined {
  const url = siteUrl();
  return url ? new InlineKeyboard().url(label, url) : undefined;
}
