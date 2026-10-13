import { FABRICATION_MARKERS } from "./memory";
import { TOOL_SPECS } from "./tools";

/**
 * Защита на выходе: текст модели не уходит человеку, если в нём след вызова
 * инструмента («сделано:», имя инструмента, JSON) или данные, которых нет в
 * результатах инструментов этого сообщения (@ники, #id, №номера). Так модель
 * не может выдать сымитированный «результат» за настоящий.
 */

export const GUARD_RETRY_NOTE = "Ты не вызвала инструмент. Вызови нужный инструмент, не пиши данные текстом.";
export const GUARD_FAIL_TEXT = "Не получилось собрать ответ, открой нужный раздел кнопкой.";

const TOOL_NAMES = TOOL_SPECS.map((t) => t.name);

export interface GuardContext {
  /** Результаты инструментов этого сообщения (как их видела модель). */
  results: readonly string[];
  /** Номера последнего показанного списка — их показал код, на них можно ссылаться. */
  listNumbers?: readonly number[];
}

/** true — текст выдуман или несёт следы инструментов. */
export function fabricated(text: string, ctx: GuardContext): boolean {
  if (FABRICATION_MARKERS.test(text)) return true;
  if (TOOL_NAMES.some((n) => text.includes(n))) return true;
  const results = ctx.results.join("\n").toLowerCase();
  for (const m of text.matchAll(/@([a-z0-9_]{3,})/gi)) if (!results.includes(`@${m[1].toLowerCase()}`)) return true;
  for (const m of text.matchAll(/#(\d+)/g)) if (!new RegExp(`"id":${m[1]}\\b`).test(results)) return true;
  for (const m of text.matchAll(/№\s?(\d+)/g)) {
    const n = Number(m[1]);
    if (!new RegExp(`"n":${n}\\b`).test(results) && !ctx.listNumbers?.includes(n)) return true;
  }
  return false;
}

/** Модель перечислила данные списком, хотя их уже показал бот. */
export const looksLikeListing = (text: string) => text.split("\n").filter((l) => /^\s*(\d+[.)]|[-•*])\s+/.test(l)).length >= 2;
