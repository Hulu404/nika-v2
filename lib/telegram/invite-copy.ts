import { InlineKeyboard } from "grammy";
import { runWhenWhere, type CoffeeRun } from "../coffeerun/run";
import { publicOriginFromEnv } from "../public-origin";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Приглашение на новый забег: «открылась запись».
 *
 * Чем отличается от остальных сообщений бота: это единственная рассылка,
 * которую человек НЕ заказывал. На перенос и отмену он подписался сам, записавшись
 * на забег; сюда он попадает потому, что бежал с нами раньше. Отсюда три правила
 * текста:
 *   • зовём на конкретный забег его спота, а не «на кофе-раны вообще»;
 *   • всё главное — спот, дата, время — в первых двух строках, чтобы решение
 *     принималось из превью чата;
 *   • отписка названа прямо, в самом сообщении. Рассылка, из которой нельзя
 *     уйти одним словом, — это спам, чем бы она ни была по смыслу.
 *
 * Тексты — чистые функции, как в notice-copy и poll-copy: формулировки
 * проверяются тестами, хендлеры остаются про логику.
 */

/** Ссылка на лендинг забега; null — без NEXT_PUBLIC_APP_URL её не собрать. */
export function landingUrlFor(run: CoffeeRun): string | null {
  const site = publicOriginFromEnv();
  return site ? `${site}${run.landing}` : null;
}

/**
 * Сообщение участнику.
 *
 * Имя берём из его прошлой заявки — оно человечнее ника в Telegram, и по нему
 * сразу видно, что пишут не в пустоту.
 */
export function inviteText(participant: { name: string }, run: CoffeeRun): string {
  return [
    `${participant.name}, открыли запись на новый забег!`,
    "",
    `${run.spotName} — ${runWhenWhere(run)}.`,
    `${run.distance} в разговорном темпе, с пейсерами. Кофе на финише.`,
    "",
    "Бежишь? Заполни заявку — так я буду знать, кого ждать на старте.",
    "",
    "Не хочешь получать приглашения — напиши /stop, больше звать не буду.",
  ].join("\n");
}

/**
 * Кнопки под приглашением: записаться, маршрут до спота, живой человек.
 *
 * «Записаться» первой и отдельной строкой — это единственное действие, ради
 * которого сообщение отправлено. Без NEXT_PUBLIC_APP_URL ссылки на лендинг нет,
 * тогда остаются маршрут и поддержка.
 */
export function inviteKeyboard(run: CoffeeRun): InlineKeyboard {
  const kb = new InlineKeyboard();
  const landing = landingUrlFor(run);

  if (landing) kb.url("Записаться", landing).row();

  return kb.url("Как добраться", run.mapUrl).row().url(SUPPORT_LABEL, SUPPORT_URL);
}

/**
 * Что организатор видит ПЕРЕД ручной рассылкой (/open).
 *
 * Показываем ровно тот текст, который уйдёт людям. Приглашение нельзя отозвать,
 * и уходит оно тем, кто ничего не просил, — поэтому предпросмотр здесь не
 * формальность, а последняя точка, где опечатку ещё можно поймать.
 */
export function invitePreviewText(
  run: CoffeeRun,
  recipients: number,
  opts: { alreadyInvited: number; optedOut: number; registered: number },
): string {
  const lines = [
    `Приглашение на забег: ${run.spotName}, ${run.dateLabel} (${run.weekday}), старт ${run.startTime}.`,
    `Получат: ${recipients} чел. — бегавшие на этом споте раньше.`,
  ];

  const skipped: string[] = [];
  if (opts.alreadyInvited) skipped.push(`уже звали: ${opts.alreadyInvited}`);
  if (opts.registered) skipped.push(`уже записаны: ${opts.registered}`);
  if (opts.optedOut) skipped.push(`просили не писать: ${opts.optedOut}`);
  if (skipped.length > 0) lines.push(`Пропускаю — ${skipped.join(", ")}.`);

  if (!landingUrlFor(run)) {
    lines.push("⚠️ NEXT_PUBLIC_APP_URL не задан — кнопки «Записаться» в сообщении не будет.");
  }

  lines.push(
    "",
    "Вот что им придёт:",
    "———",
    inviteText({ name: "Имя" }, run),
    "———",
    "",
    "Отправляем?",
  );

  return lines.join("\n");
}

/**
 * callback_data подтверждения: `op_go_<спот>_<дата>` / `op_no`.
 *
 * Слаг ограничен 40 символами не от балды: Telegram режет callback_data на
 * 64 байтах, а «op_go_» + «_» + дата съедают 17. Слаг с «_» внутри разрешён —
 * разбор режет дату с конца и такой слаг переживает (см. parseInviteCallback).
 */
export const INVITE_CALLBACK_RE = /^op_(go_[a-z0-9_-]{1,40}_\d{4}-\d{2}-\d{2}|no)$/;

export function inviteConfirmKeyboard(spot: string, runDate: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разослать приглашение", `op_go_${spot}_${runDate}`)
    .row()
    .text("Отмена", "op_no");
}

/**
 * Разбор нажатия. null — данные не наши; "cancel" — организатор передумал.
 *
 * Дата стоит последней и имеет жёсткую длину, поэтому режем с конца: слаг спота
 * сам может содержать «_», и поиск разделителя слева его бы разорвал.
 */
export function parseInviteCallback(
  data: string,
): { action: "send"; spot: string; runDate: string } | { action: "cancel" } | null {
  if (!INVITE_CALLBACK_RE.test(data)) return null;
  if (data === "op_no") return { action: "cancel" };

  const rest = data.slice("op_go_".length);
  const sep = rest.lastIndexOf("_");
  return { action: "send", spot: rest.slice(0, sep), runDate: rest.slice(sep + 1) };
}

/** Итог рассылки приглашения — для организатора. */
export function inviteReportText(res: {
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
}): string {
  const tail = res.hasMore ? " Остались неотправленные — повтори /open." : "";
  return (
    `Разослала приглашение: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
    `Не дошло: ${res.failed ?? 0}.${tail}`
  );
}
