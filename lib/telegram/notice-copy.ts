import { InlineKeyboard } from "grammy";
import { upcomingRuns, type CoffeeRun } from "../coffeerun/run";
import { publicOriginFromEnv } from "../public-origin";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Объявления по забегу: перенос старта на другое время того же дня и отмена.
 *
 * Зачем отдельно от опроса: опрос спрашивает, а это — сообщает. Льёт с утра —
 * организатор либо двигает забег на вечер, либо отменяет, и все, кто записан,
 * должны узнать об этом одним понятным сообщением, где суть видна с первой
 * строки (её человек читает в превью чата, не открывая).
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
 * Сообщение об отмене забега.
 *
 * Правила текста: слово «отменяем» в первой строке — это главное и его должно
 * быть видно в превью чата; причина сразу за ним, потому что первый же вопрос
 * человека будет «почему»; извинение короткое и без театра; в конце — куда идти
 * дальше, чтобы отмена не читалась как «всё, до свидания».
 *
 * Про перенос здесь молчим намеренно: если старт двигают, для этого есть
 * /moved, а «отменяем, но вообще-то приходите вечером» — способ собрать людей
 * на несуществующий забег.
 */
export function cancelText(
  signup: { name: string },
  run: CoffeeRun,
  reason: string | null,
): string {
  const lines = [`${signup.name}, сегодняшний забег отменяем.`, ""];

  if (reason) lines.push(`Причина: ${reason}.`, "");

  lines.push(
    `${run.spotName}, ${run.dateLabel} — не бежим. Приходить не нужно.`,
    "",
    "Жаль, что так вышло: место за тобой на следующем забеге, ничего заново " +
      "заполнять не надо — я напишу, как объявим дату.",
  );

  return lines.join("\n");
}

/**
 * Кнопки под объявлением об отмене: соседние забеги, если они есть, и живой
 * человек. Кнопку «Как добраться» здесь не показываем — идти некуда.
 *
 * Сам отменённый забег из списка исключаем: он ещё считается будущим весь свой
 * день, и звать на него после отмены было бы издевательством.
 */
export function cancelKeyboard(cancelled: CoffeeRun): InlineKeyboard {
  const kb = new InlineKeyboard();
  const site = publicOriginFromEnv();

  if (site) {
    for (const run of upcomingRuns()) {
      if (run.spot === cancelled.spot && run.date === cancelled.date) continue;
      kb.url(`Кофе-ран · ${run.spotName}, ${run.dateLabel}`, `${site}${run.landing}`).row();
    }
  }

  return kb.url(SUPPORT_LABEL, SUPPORT_URL);
}

/** Предпросмотр отмены для организатора — тот же текст, что уйдёт людям. */
export function cancelPreviewText(
  run: CoffeeRun,
  reason: string | null,
  recipients: number,
): string {
  return [
    `ОТМЕНА забега: ${run.spotName}, ${run.dateLabel} (${run.weekday}), старт ${run.startTime}.`,
    `Получат: ${recipients} чел. — все, кто подтвердил участие.`,
    "",
    "Вот что им придёт:",
    "———",
    cancelText({ name: "Имя" }, run, reason),
    "———",
    "",
    "Отменяем? Отозвать это сообщение будет нельзя.",
  ].join("\n");
}

/** callback_data подтверждения отмены: `cx_go_<дата>` / `cx_no`. */
export const CANCEL_CALLBACK_RE = /^cx_(go_\d{4}-\d{2}-\d{2}|no)$/;

export function cancelConfirmKeyboard(runDate: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да, отменить забег", `cx_go_${runDate}`)
    .row()
    .text("Нет, оставить", "cx_no");
}

/** Разбор нажатия. null — данные не наши; "cancel" — организатор передумал. */
export function parseCancelCallback(
  data: string,
): { action: "send"; runDate: string } | { action: "cancel" } | null {
  if (!CANCEL_CALLBACK_RE.test(data)) return null;
  if (data === "cx_no") return { action: "cancel" };
  return { action: "send", runDate: data.slice("cx_go_".length) };
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

/**
 * Итог рассылки — то же по смыслу, что и у опроса, но про объявление.
 * `label` подставляется в винительном падеже: «перенос», «отмену».
 */
export function noticeReportText(
  res: { sent?: number; blocked?: number; failed?: number; hasMore?: boolean },
  label: string,
): string {
  const tail = res.hasMore ? " Остались неотправленные — повтори команду." : "";
  return (
    `Разослала ${label}: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
    `Не дошло: ${res.failed ?? 0}.${tail}`
  );
}
