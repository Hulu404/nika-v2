import { InlineKeyboard } from "grammy";
import { publicOriginFromEnv } from "../public-origin";

/**
 * Единая кнопка перехода на сайт для бот-сообщений. Роль бота — уведомления,
 * поэтому «перейти на сайт» вынесено в одно место и переиспользуется чек-инами,
 * рекомендациями, пуш-дублями и онбордингом.
 *
 * Базовый URL — NEXT_PUBLIC_APP_URL, нормализованный к origin (см.
 * publicOriginFromEnv: переменная уже приезжала на прод с лишним путём, и тогда
 * кнопка вела в никуда). Без переменной кнопки нет (undefined → grammy просто
 * не покажет клавиатуру), сообщение всё равно уходит.
 */
export function siteUrl(): string | null {
  return publicOriginFromEnv();
}

export function siteKeyboard(label = "Открыть НИКУ"): InlineKeyboard | undefined {
  const url = siteUrl();
  return url ? new InlineKeyboard().url(label, url) : undefined;
}

/**
 * Живая поддержка мероприятий — личка организатора. Держим здесь, рядом с
 * остальными CTA бота, чтобы адрес не расползался по текстам.
 */
export const SUPPORT_URL = "https://t.me/meine_nika";
export const SUPPORT_LABEL = "Служба поддержки";

/** Клавиатура из одной кнопки поддержки — для сообщений без другого контекста. */
export function supportKeyboard(): InlineKeyboard {
  return new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL);
}
