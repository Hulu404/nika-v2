import type { MessageEntity } from "grammy/types";
import { escapeHtml } from "./html";

/**
 * Разметка статей справочника (ТЗ 4.9): Telegram HTML, разрешены только
 * <b>, <i>, <a href>, <code>. У ссылки — только https:// и tg://: javascript:,
 * http:, data: и прочее вычищаются вместе с тегом (текст ссылки остаётся).
 * Всё остальное экранируется и видно в предпросмотре как есть.
 *
 * Санитайзер — единственная дверь в databot_kb.body: статью показывают всем
 * зонам с parse_mode HTML, и незакрытый тег уронил бы отправку, а чужой
 * атрибут — превратился бы в дыру.
 */

const ALLOWED = new Set(["b", "i", "code", "a"]);
const SAFE_HREF = /^(https:\/\/|tg:\/\/)/i;
/** Сущности, которые Telegram HTML понимает сам, — их не экранируем повторно. */
const ENTITY = /^&(lt|gt|amp|quot|#\d{1,6}|#x[0-9a-f]{1,6});/i;
const TAG = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;

/** Текст вне тегов: «<», «>» и голые «&» экранируются, готовые сущности остаются. */
function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "&") out += ENTITY.test(text.slice(i)) ? "&" : "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else out += ch;
  }
  return out;
}

/** href из атрибутов тега; только в кавычках, без кавычек — не ссылка. */
function hrefOf(attrs: string): string | null {
  const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!m) return null;
  const raw = (m[2] ?? m[3] ?? "").trim();
  // Сущности внутри href («&#106;avascript:») разворачиваем перед проверкой.
  const decoded = raw.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
  return SAFE_HREF.test(decoded) ? decoded : null;
}

/**
 * Чистый HTML для Telegram. Незакрытые теги закрываются в конце; закрывающий
 * тег не по порядку закрывает всё, что открыто внутри него (Telegram не
 * принимает перекрёстную вложенность); лишний закрывающий — выбрасывается.
 */
export function sanitizeKbHtml(input: string): string {
  let out = "";
  const stack: string[] = [];
  let last = 0;
  TAG.lastIndex = 0;

  for (let m = TAG.exec(input); m; m = TAG.exec(input)) {
    out += escapeText(input.slice(last, m.index));
    last = TAG.lastIndex;

    const closing = m[1] === "/";
    const name = m[2].toLowerCase();

    if (!ALLOWED.has(name)) {
      // Чужой тег — не разметка, а текст: видно в предпросмотре как есть.
      out += escapeText(m[0]);
      continue;
    }

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue; // закрывающий без открывающего — выбрасываем
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }

    if (name === "a") {
      const href = hrefOf(m[3]);
      if (!href) {
        // Небезопасная ссылка: тег выбрасываем, текст внутри остаётся текстом,
        // а парный </a> потом не найдёт открывающего и тоже уйдёт.
        continue;
      }
      out += `<a href="${href.replace(/"/g, "&quot;")}">`;
    } else {
      // Атрибуты у <b>, <i>, <code> не нужны — onclick и прочее отбрасываются.
      out += `<${name}>`;
    }
    stack.push(name);
  }

  out += escapeText(input.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

/** Длина текста без тегов — то, что человек видит (для лимита заголовка и пр.). */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/&(lt|gt|amp|quot);/g, "_").length;
}

/**
 * Сообщение с форматированием Telegram (жирный, курсив, ссылка, код) → HTML.
 * Без форматирования текст считается HTML, набранным руками, и уходит в
 * санитайзер как есть. Смещения entities — в UTF-16, как и строки JS.
 */
export function messageToKbHtml(text: string, entities: readonly MessageEntity[] | undefined): string {
  const marks = (entities ?? []).filter((e) =>
    ["bold", "italic", "code", "pre", "text_link"].includes(e.type),
  );
  if (marks.length === 0) return sanitizeKbHtml(text);

  const open = new Map<number, string[]>();
  const close = new Map<number, string[]>();
  const add = (map: Map<number, string[]>, at: number, tag: string, front = false) => {
    const list = map.get(at) ?? [];
    if (front) list.unshift(tag);
    else list.push(tag);
    map.set(at, list);
  };
  // Внешние сущности открываются раньше и закрываются позже — вложенность верная.
  const sorted = [...marks].sort((a, b) => a.offset - b.offset || b.length - a.length);
  for (const e of sorted) {
    const tag =
      e.type === "bold" ? "b" : e.type === "italic" ? "i" : e.type === "text_link" ? "a" : "code";
    const openTag = tag === "a" ? `<a href="${(e as { url?: string }).url ?? ""}">` : `<${tag}>`;
    add(open, e.offset, openTag);
    add(close, e.offset + e.length, `</${tag}>`, true);
  }

  let html = "";
  for (let i = 0; i <= text.length; i++) {
    for (const t of close.get(i) ?? []) html += t;
    for (const t of open.get(i) ?? []) html += t;
    if (i < text.length) html += escapeHtml(text[i]);
  }
  // Итог всё равно проходит санитайзер: ссылка из entities может быть http:.
  return sanitizeKbHtml(html);
}
