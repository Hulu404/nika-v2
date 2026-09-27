import { SECTIONS, type Section } from "./types";

/**
 * callback_data бота данных: d:<раздел>:<действие>[:<параметры>].
 *
 * Telegram ограничивает callback_data 64 БАЙТАМИ, а не символами. Все части у
 * нас ASCII, но проверяем именно байты: кириллица в параметре (подпись,
 * название) удвоила бы длину незаметно для глаза.
 *
 * Параметры не могут содержать «:» — это разделитель. Сборка бросает
 * исключение на нарушение: такую кнопку надо чинить в коде, а не отправлять.
 */
export const CALLBACK_PREFIX = "d";
export const CALLBACK_MAX_BYTES = 64;

export interface ParsedCallback {
  section: Section;
  action: string;
  params: string[];
}

export function callbackBytes(data: string): number {
  return Buffer.byteLength(data, "utf8");
}

export function cb(section: Section, action: string, ...params: Array<string | number>): string {
  const parts = [CALLBACK_PREFIX, section, action, ...params.map(String)];
  for (const part of parts.slice(2)) {
    if (part === "" || part.includes(":")) {
      throw new Error(`callback: пустая часть или «:» в «${part}»`);
    }
  }
  const data = parts.join(":");
  if (callbackBytes(data) > CALLBACK_MAX_BYTES) {
    throw new Error(`callback длиннее ${CALLBACK_MAX_BYTES} байт: ${data}`);
  }
  return data;
}

/** Разбор. Чужой формат, неизвестный раздел или пустое действие — null. */
export function parseCallback(data: string | undefined | null): ParsedCallback | null {
  if (!data || callbackBytes(data) > CALLBACK_MAX_BYTES) return null;
  const [prefix, section, action, ...params] = data.split(":");
  if (prefix !== CALLBACK_PREFIX) return null;
  if (!(SECTIONS as readonly string[]).includes(section)) return null;
  if (!action) return null;
  if (params.some((p) => p === "")) return null;
  return { section: section as Section, action, params };
}
