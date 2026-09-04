import { InlineKeyboard } from "grammy";
import type { CoffeeRun } from "../coffeerun/run";
import type { PollAnswer, PollSummary, PollVote } from "./poll-store";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Все тексты опроса про погоду в одном месте — и вопрос участнику, и лента
 * организатору, и сводка. Чистые функции: формулировки проверяются тестами,
 * а хендлеры бота остаются про логику.
 */

/**
 * callback_data: `crp_y_<дата забега>` / `crp_n_<дата забега>`.
 *
 * Дата внутри кнопки, потому что состояние опроса живёт в памяти процесса: если
 * опрос успели переключить на другой забег (или процесс перезапустили), мы всё
 * равно понимаем, на какой вопрос отвечает человек, и не считаем воскресный
 * ответ за субботний. 14 байт при лимите Telegram в 64.
 */
const PREFIX = "crp_";
const CODE: Record<PollAnswer, string> = { yes: "y", no: "n" };

/** Регексп для регистрации хендлера в боте — один источник и здесь, и в bot.ts. */
export const POLL_CALLBACK_RE = /^crp_[yn]_\d{4}-\d{2}-\d{2}$/;

export function buildPollCallback(answer: PollAnswer, runDate: string): string {
  return `${PREFIX}${CODE[answer]}_${runDate}`;
}

/** Разбор callback_data. null — данные не наши или битые. */
export function parsePollCallback(
  data: string,
): { answer: PollAnswer; runDate: string } | null {
  if (!POLL_CALLBACK_RE.test(data)) return null;
  const code = data.slice(PREFIX.length, PREFIX.length + 1);
  return { answer: code === "y" ? "yes" : "no", runDate: data.slice(PREFIX.length + 2) };
}

/**
 * Вопрос участнику.
 *
 * Тон: забег НЕ отменён, решение за человеком, и «не побегу» — нормальный ответ,
 * а не провинность. Иначе опрос соберёт вежливые «побегу» вместо правды, ради
 * которой он и затевался.
 */
export function pollText(signup: { name: string }, run: CoffeeRun): string {
  return [
    `${signup.name}, на завтра обещают дождь. ☔️`,
    "",
    `Забег мы не отменяем: ${run.spotName}, сбор в ${run.gatherTime}, ` +
      `старт в ${run.startTime}. ${run.distance} и горячий кофе на финише — в любую погоду.`,
    "",
    "Скажи честно, чтобы мы знали, на скольких рассчитывать: побежишь под дождём?",
  ].join("\n");
}

/** Две кнопки ответа + живой человек, если вопрос не про погоду. */
export function pollKeyboard(runDate: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Побегу ☔️", buildPollCallback("yes", runDate))
    .row()
    .text("Не побегу", buildPollCallback("no", runDate))
    .row()
    .url(SUPPORT_LABEL, SUPPORT_URL);
}

/** Что бот отвечает участнику на нажатие. */
export function pollReplyText(answer: PollAnswer, run: CoffeeRun): string {
  if (answer === "yes") {
    return [
      "Записала: ты бежишь. ☔️",
      "",
      `Ждём в ${run.gatherTime} — ${run.address}, ${run.place}.`,
      "Возьми сухую футболку на после: кофе приятнее пить в сухом.",
    ].join("\n");
  }
  return [
    "Поняла, завтра без тебя — спасибо, что предупредил(а).",
    "",
    "Дождь не последний, а забеги у нас регулярные: увидимся на следующем.",
  ].join("\n");
}

/** Как человек подписан в ленте организатора: имя из заявки + ник для связи. */
export function personLabel(p: { name: string; username: string | null }): string {
  return p.username ? `${p.name} (@${p.username})` : p.name;
}

/**
 * Одна строка ленты: пришёл ответ. Это и есть «просмотр опроса» — организатор
 * читает ленту в личке, и она переживает любой перезапуск сервера.
 */
export function voteLine(vote: PollVote, tally: { yes: number; no: number }): string {
  const verdict = vote.answer === "yes" ? "ПОБЕЖИТ ☔️" : "не побежит";
  return `${personLabel(vote)} — ${verdict}\n\nИтого: побегут ${tally.yes}, не побегут ${tally.no}.`;
}

/** Список имён столбиком, максимум `limit` — чтобы сводка влезала в сообщение. */
function nameList(people: Array<{ name: string; username: string | null }>, limit = 40): string {
  if (people.length === 0) return "  —";
  const shown = people.slice(0, limit).map((p) => `  • ${personLabel(p)}`);
  if (people.length > limit) shown.push(`  … и ещё ${people.length - limit}`);
  return shown.join("\n");
}

/** Полная сводка по команде /poll. */
export function summaryText(summary: PollSummary, run: CoffeeRun | null): string {
  if (!summary.runDate) {
    return "Опрос ещё не запускала. Команда /pollsend разошлёт вопрос про дождь участникам ближайшего забега.";
  }

  const where = run ? `${run.spotName}, ${run.dateLabel}` : summary.runDate;

  return [
    `Опрос «побежишь под дождём?» — ${where}`,
    "",
    `Побегут: ${summary.yes.length}`,
    nameList(summary.yes),
    "",
    `Не побегут: ${summary.no.length}`,
    nameList(summary.no),
    "",
    `Молчат: ${summary.silent.length}`,
    nameList(summary.silent),
    "",
    `Всего спросили: ${summary.asked}`,
  ].join("\n");
}
