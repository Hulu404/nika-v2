import { InlineKeyboard } from "grammy";
import type { CoffeeRun } from "../coffeerun/run";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Объявление о переносе старта на другое время того же дня.
 *
 * Зачем отдельно от опроса: опрос спрашивает, а это — сообщает. Утром льёт,
 * организатор двигает забег на вечер, и все, кто записан, должны узнать об этом
 * одним понятным сообщением, где новое время видно с первой строки.
 *
 * Тексты — чистые функции, как и в poll-copy: формулировка проверяется тестами,
 * а хендлеры остаются про логику.
 */

/** Насколько раньше старта собираемся — как и в обычном забеге. */
const GATHER_LEAD_MIN = 15;

/**
 * Время из аргумента команды: «18:00», «18.00», «18» → «18:00».
 * null — не время (значит, аргумент был про что-то другое).
 */
export function parseTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${h}:${String(min).padStart(2, "0")}`;
}

/** Время сбора: за 15 минут до нового старта. */
export function gatherFor(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m - GATHER_LEAD_MIN;
  // Перенос на 00:10 — теоретическая дичь, но в минус уходить всё равно нельзя.
  const safe = ((total % 1440) + 1440) % 1440;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Сообщение участнику.
 *
 * Правила текста: новое время в первой строке (человек читает превью в списке
 * чатов и должен всё понять там), старое время названо прямо — иначе на старом
 * месте в 9:15 кто-нибудь всё равно окажется, — и ни слова упрёка тем, кто
 * не сможет прийти вечером.
 */
export function movedText(
  signup: { name: string },
  run: CoffeeRun,
  newStart: string,
  reason: string | null,
): string {
  const lines = [
    `${signup.name}, переносим старт: сегодня бежим в ${newStart}, не в ${run.startTime}.`,
    "",
  ];

  if (reason) lines.push(`Причина: ${reason}.`, "");

  lines.push(
    `Место то же — ${run.address}, ${run.place}.`,
    `Сбор в ${gatherFor(newStart)}, старт в ${newStart}.`,
    `${run.distance} в разговорном темпе, с пейсерами. Кофе на финише.`,
    "",
    "Если вечером не сможешь — ничего страшного, увидимся на следующем забеге.",
  );

  return lines.join("\n");
}

/** Кнопки под объявлением: маршрут до спота и живой человек с вопросами. */
export function movedKeyboard(run: CoffeeRun): InlineKeyboard {
  return new InlineKeyboard().url("Как добраться", run.mapUrl).row().url(SUPPORT_LABEL, SUPPORT_URL);
}

/**
 * Что организатор видит ПЕРЕД рассылкой. Показываем ровно тот текст, который
 * уйдёт людям: объявление о переносе нельзя отозвать, и единственная защита от
 * опечатки во времени — прочитать сообщение до отправки.
 */
export function movedPreviewText(
  run: CoffeeRun,
  newStart: string,
  reason: string | null,
  recipients: number,
): string {
  return [
    `Забег: ${run.spotName}, ${run.dateLabel} (${run.weekday}).`,
    `Новый старт: ${newStart} (было ${run.startTime}). Сбор в ${gatherFor(newStart)}.`,
    `Получат: ${recipients} чел. — все, кто подтвердил участие.`,
    "",
    "Вот что им придёт:",
    "———",
    movedText({ name: "Имя" }, run, newStart, reason),
    "———",
    "",
    "Отправляем?",
  ].join("\n");
}

/**
 * callback_data кнопок подтверждения: `mv_go_<дата>_<время>` / `mv_no`.
 * Причина в кнопку не влезает по длине — её держит стор черновиков.
 */
export const MOVED_CALLBACK_RE = /^mv_(go_\d{4}-\d{2}-\d{2}_\d{1,2}:\d{2}|no)$/;

export function movedConfirmKeyboard(runDate: string, newStart: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разослать", `mv_go_${runDate}_${newStart}`)
    .row()
    .text("Отмена", "mv_no");
}

/** Разбор нажатия. null — данные не наши; "cancel" — отмена. */
export function parseMovedCallback(
  data: string,
): { action: "send"; runDate: string; newStart: string } | { action: "cancel" } | null {
  if (!MOVED_CALLBACK_RE.test(data)) return null;
  if (data === "mv_no") return { action: "cancel" };
  const rest = data.slice("mv_go_".length);
  const sep = rest.indexOf("_");
  return { action: "send", runDate: rest.slice(0, sep), newStart: rest.slice(sep + 1) };
}

/** Итог рассылки — то же по смыслу, что и у опроса, но про объявление. */
export function movedReportText(res: {
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
}): string {
  const tail = res.hasMore ? " Остались неотправленные — повтори команду." : "";
  return (
    `Разослала перенос: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
    `Не дошло: ${res.failed ?? 0}.${tail}`
  );
}
