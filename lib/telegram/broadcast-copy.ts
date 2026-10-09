import { InlineKeyboard } from "grammy";

/**
 * Общая рассылка организатора (/say): тексты, кнопки и меню команд.
 *
 * Сообщение пишет сам организатор, поэтому слов «от бота» здесь нет — только
 * служебные реплики вокруг: что уйдёт, скольким, чем кончилось. Чистые функции,
 * как в invite-copy и notice-copy: формулировки проверяются тестами.
 */

/** Ответ на /say: ждём само сообщение следующим. */
export const BROADCAST_ASK_TEXT =
  "Пришли сообщение, которое разослать — текстом, с фото, как угодно: " +
  "уйдёт копией, со всем форматированием.\n\n" +
  "Получат все, кто хоть раз подтверждал участие в забеге, кроме попросивших не писать. " +
  "Перед отправкой покажу, скольким уйдёт, — и без кнопки «Разослать» никто ничего не получит.";

/**
 * Предпросмотр. Само сообщение организатор видит прямо над этим ответом (бот
 * отвечает на него реплаем), поэтому текст не повторяем — только кому и сколько.
 */
export function broadcastPreviewText(recipients: number, opts: { optedOut: number }): string {
  const lines = [
    `Это сообщение уйдёт ${recipients} чел. — всем, кто хоть раз подтверждал участие в забеге.`,
  ];
  if (opts.optedOut) lines.push(`Пропускаю — просили не писать: ${opts.optedOut}.`);
  lines.push("", "Отозвать его после отправки нельзя. Отправляем?");
  return lines.join("\n");
}

/**
 * callback_data: `bc_go_<id сообщения>` / `bc_no`. Сообщение-источник лежит в
 * чате организатора, так что id в кнопке хватает: черновик в памяти не нужен
 * и переживать перезапуск ему незачем.
 */
export const BROADCAST_CALLBACK_RE = /^bc_(go_\d{1,12}|no)$/;

export function broadcastConfirmKeyboard(messageId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разослать", `bc_go_${messageId}`)
    .row()
    .text("Отмена", "bc_no");
}

/** Под отчётом, если кому-то не дошло: повтор шлёт только недополучившим. */
export function broadcastRetryKeyboard(messageId: number): InlineKeyboard {
  return new InlineKeyboard().text("Дослать остальным", `bc_go_${messageId}`);
}

export function parseBroadcastCallback(
  data: string,
): { action: "send"; messageId: number } | { action: "cancel" } | null {
  if (!BROADCAST_CALLBACK_RE.test(data)) return null;
  if (data === "bc_no") return { action: "cancel" };
  return { action: "send", messageId: Number(data.slice("bc_go_".length)) };
}

/** Итог рассылки — для организатора. */
export function broadcastReportText(res: {
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
}): string {
  const tail =
    res.failed || res.hasMore ? " Кнопка ниже дошлёт тем, кому не дошло — остальных не задену." : "";
  return (
    `Разослала: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
    `Не дошло: ${res.failed ?? 0}.${tail}`
  );
}

/**
 * Меню команд в чате организатора (кнопка «Меню» в Telegram). Ставится только
 * этому чату после /admin — участники организаторских команд не видят.
 * Описания короткие: Telegram режет их в меню.
 */
export const ADMIN_COMMANDS = [
  { command: "say", description: "Общее сообщение всем участникам" },
  { command: "open", description: "Пригласить на новый забег" },
  { command: "rollcall", description: "Перекличка: кто придёт сегодня" },
  { command: "moved", description: "Перенести старт" },
  { command: "cancel", description: "Отменить забег" },
  { command: "pollsend", description: "Вопрос про дождь накануне" },
  { command: "poll", description: "Сводка ответов" },
  { command: "pollstop", description: "Выйти из режима организатора" },
  { command: "help", description: "Что умеет бот" },
];
