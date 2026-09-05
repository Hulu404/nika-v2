import { InlineKeyboard } from "grammy";
import type { CoffeeRun } from "../coffeerun/run";
import type { PollAnswer, PollKind, PollSummary, PollVote } from "./poll-store";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Все тексты опроса в одном месте — и вопрос участнику, и лента организатору,
 * и сводка. Чистые функции: формулировки проверяются тестами, а хендлеры бота
 * остаются про логику.
 *
 * Вопросов два (PollKind), механика у них общая, а слова разные:
 *   rain     — накануне: «завтра дождь, побежишь?»;
 *   rollcall — в день забега: «придёшь сегодня в 18:00?» (перекличка).
 * Поэтому текст везде выбирается по виду, а не пишется дважды.
 */

/**
 * callback_data: `crp_y_<дата забега>_<вид>` (вид: r — дождь, c — перекличка).
 *
 * Дата и вид внутри кнопки, потому что состояние опроса живёт в памяти
 * процесса: даже если опрос успели переключить (или процесс перезапустили), мы
 * понимаем, на какой именно вопрос отвечает человек, и не засчитываем ответ про
 * дождь в перекличку. 16 байт при лимите Telegram в 64.
 *
 * Суффикс вида необязателен: кнопки, разосланные до его появления, остаются
 * рабочими и читаются как «дождь» — люди уже держат их в переписке.
 */
const PREFIX = "crp_";
const CODE: Record<PollAnswer, string> = { yes: "y", no: "n" };
const KIND_CODE: Record<PollKind, string> = { rain: "r", rollcall: "c" };

/** Регексп для регистрации хендлера в боте — один источник и здесь, и в bot.ts. */
export const POLL_CALLBACK_RE = /^crp_[yn]_\d{4}-\d{2}-\d{2}(_[rc])?$/;

export function buildPollCallback(
  answer: PollAnswer,
  runDate: string,
  kind: PollKind = "rain",
): string {
  return `${PREFIX}${CODE[answer]}_${runDate}_${KIND_CODE[kind]}`;
}

/** Разбор callback_data. null — данные не наши или битые. */
export function parsePollCallback(
  data: string,
): { answer: PollAnswer; runDate: string; kind: PollKind } | null {
  if (!POLL_CALLBACK_RE.test(data)) return null;
  const code = data.slice(PREFIX.length, PREFIX.length + 1);
  const [runDate, kindCode] = data.slice(PREFIX.length + 2).split("_");
  return {
    answer: code === "y" ? "yes" : "no",
    runDate,
    kind: kindCode === "c" ? "rollcall" : "rain",
  };
}

/** Сбор за 15 минут до старта — как и в остальных сообщениях бота. */
function gatherBefore(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = (((h * 60 + m - 15) % 1440) + 1440) % 1440;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Вопрос участнику.
 *
 * Тон в обоих видах общий: забег НЕ отменён, решение за человеком, и «не приду» —
 * нормальный ответ, а не провинность. Иначе опрос соберёт вежливые «побегу»
 * вместо правды, ради которой он и затевался.
 *
 * @param startTime время старта для переклички; null — штатное время забега
 */
export function pollText(
  signup: { name: string },
  run: CoffeeRun,
  kind: PollKind = "rain",
  startTime: string | null = null,
): string {
  if (kind === "rollcall") {
    const start = startTime ?? run.startTime;
    return [
      `${signup.name}, перекличка перед стартом. 🏃`,
      "",
      `Сегодня бежим в ${start} — ${run.address}, ${run.place}.`,
      `Сбор в ${gatherBefore(start)}. ${run.distance} в разговорном темпе, с пейсерами. ` +
        "Кофе на финише.",
      "",
      "Отметься одной кнопкой, чтобы мы знали, скольких ждать: придёшь?",
    ].join("\n");
  }

  return [
    `${signup.name}, на завтра обещают дождь. ☔️`,
    "",
    `Забег мы не отменяем: ${run.spotName}, сбор в ${run.gatherTime}, ` +
      `старт в ${run.startTime}. ${run.distance} и горячий кофе на финише — в любую погоду.`,
    "",
    "Скажи честно, чтобы мы знали, на скольких рассчитывать: побежишь под дождём?",
  ].join("\n");
}

/** Две кнопки ответа + живой человек, если вопрос не про забег. */
export function pollKeyboard(runDate: string, kind: PollKind = "rain"): InlineKeyboard {
  const [yes, no] = kind === "rollcall" ? ["Приду 🏃", "Не приду"] : ["Побегу ☔️", "Не побегу"];
  return new InlineKeyboard()
    .text(yes, buildPollCallback("yes", runDate, kind))
    .row()
    .text(no, buildPollCallback("no", runDate, kind))
    .row()
    .url(SUPPORT_LABEL, SUPPORT_URL);
}

/** Что бот отвечает участнику на нажатие. */
export function pollReplyText(
  answer: PollAnswer,
  run: CoffeeRun,
  kind: PollKind = "rain",
  startTime: string | null = null,
): string {
  if (kind === "rollcall") {
    const start = startTime ?? run.startTime;
    if (answer === "yes") {
      return [
        "Отметила: ты в списке. 🏃",
        "",
        `Ждём к ${gatherBefore(start)} — ${run.address}, ${run.place}. Старт в ${start}.`,
      ].join("\n");
    }
    return [
      "Поняла, сегодня без тебя — спасибо, что отметил(а)сь.",
      "",
      "Забеги у нас регулярные: увидимся на следующем.",
    ].join("\n");
  }

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
export function voteLine(
  vote: PollVote,
  tally: { yes: number; no: number },
  kind: PollKind = "rain",
): string {
  const verdict =
    kind === "rollcall"
      ? vote.answer === "yes"
        ? "ПРИДЁТ 🏃"
        : "не придёт"
      : vote.answer === "yes"
        ? "ПОБЕЖИТ ☔️"
        : "не побежит";
  const tallyLine =
    kind === "rollcall"
      ? `Итого: придут ${tally.yes}, не придут ${tally.no}.`
      : `Итого: побегут ${tally.yes}, не побегут ${tally.no}.`;
  return `${personLabel(vote)} — ${verdict}\n\n${tallyLine}`;
}

/**
 * Предпросмотр переклички для организатора — ровно тот текст, который уйдёт
 * людям. Перекличка называет время старта, а его легко перепутать после
 * переноса: прочитать сообщение до отправки дешевле, чем разослать неверное.
 */
export function rollcallPreviewText(
  run: CoffeeRun,
  startTime: string,
  recipients: number,
  moved: boolean,
): string {
  return [
    `Забег: ${run.spotName}, ${run.dateLabel} (${run.weekday}).`,
    `Старт в перекличке: ${startTime}` +
      (moved ? " — время последнего объявленного переноса." : "."),
    `Получат: ${recipients} чел. — все, кто подтвердил участие.`,
    "",
    "Вот что им придёт:",
    "———",
    pollText({ name: "Имя" }, run, "rollcall", startTime),
    "———",
    "",
    "Отправляем?",
  ].join("\n");
}

/** callback_data кнопок подтверждения переклички: `rc_go_<дата>_<время>` / `rc_no`. */
export const ROLLCALL_CALLBACK_RE = /^rc_(go_\d{4}-\d{2}-\d{2}_\d{1,2}:\d{2}|no)$/;

export function rollcallConfirmKeyboard(runDate: string, startTime: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разослать", `rc_go_${runDate}_${startTime}`)
    .row()
    .text("Отмена", "rc_no");
}

/** Разбор нажатия. null — данные не наши; "cancel" — отмена. */
export function parseRollcallCallback(
  data: string,
): { action: "send"; runDate: string; startTime: string } | { action: "cancel" } | null {
  if (!ROLLCALL_CALLBACK_RE.test(data)) return null;
  if (data === "rc_no") return { action: "cancel" };
  const rest = data.slice("rc_go_".length);
  const sep = rest.indexOf("_");
  return { action: "send", runDate: rest.slice(0, sep), startTime: rest.slice(sep + 1) };
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
    return (
      "Опрос ещё не запускала.\n\n" +
      "/rollcall — перекличка «кто придёт сегодня»\n" +
      "/pollsend — вопрос про дождь накануне"
    );
  }

  const where = run ? `${run.spotName}, ${run.dateLabel}` : summary.runDate;
  const rollcall = summary.kind === "rollcall";
  const start = summary.startTime ?? run?.startTime;

  return [
    rollcall
      ? `Перекличка «придёшь сегодня?» — ${where}${start ? `, старт в ${start}` : ""}`
      : `Опрос «побежишь под дождём?» — ${where}`,
    "",
    `${rollcall ? "Придут" : "Побегут"}: ${summary.yes.length}`,
    nameList(summary.yes),
    "",
    `${rollcall ? "Не придут" : "Не побегут"}: ${summary.no.length}`,
    nameList(summary.no),
    "",
    `Молчат: ${summary.silent.length}`,
    nameList(summary.silent),
    "",
    `Всего спросили: ${summary.asked}`,
  ].join("\n");
}
