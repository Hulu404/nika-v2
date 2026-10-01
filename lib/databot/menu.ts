import type { Api, Keyboard } from "grammy";
import { Keyboard as KeyboardBuilder } from "grammy";
import type { BotCommand, ReplyKeyboardRemove } from "grammy/types";
import { cb } from "./callback";
import { HELP_COMMAND_DESCRIPTION, SECTION_COMMAND_DESCRIPTION, SECTION_LABEL } from "./copy";
import { isEnvOwner } from "./access";
import { SECTION_COMMAND, visibleSections } from "./sections";
import type { InlineButton, Section, Subject, Zone } from "./types";

/**
 * Меню человека: постоянная клавиатура и меню команд Telegram. Оба строятся
 * из visibleSections — поэтому неготового или чужого раздела нет ни там, ни
 * там.
 */

/** Постоянная клавиатура по два раздела в ряд. Пусто — клавиатуру убрать. */
export function replyKeyboard(sections: readonly Section[]): Keyboard | ReplyKeyboardRemove {
  if (sections.length === 0) return { remove_keyboard: true };
  const kb = new KeyboardBuilder();
  sections.forEach((s, i) => {
    kb.text(SECTION_LABEL[s]);
    if (i % 2 === 1 && i < sections.length - 1) kb.row();
  });
  return kb.persistent().resized();
}

/** Для чужих: убрать клавиатуру, если у человека осталась старая. */
export const REMOVE_KEYBOARD: ReplyKeyboardRemove = { remove_keyboard: true };

/** Меню команд: разделы зоны, задачи и /help. Команды списков задач — только владельцу. */
export function commandsFor(sections: readonly Section[], isOwner = false): BotCommand[] {
  return [
    ...sections.map((s) => ({ command: SECTION_COMMAND[s], description: SECTION_COMMAND_DESCRIPTION[s] })),
    { command: "assigned", description: "Назначенные мне задачи" },
    ...(isOwner ? [
      { command: "assign", description: "Раздать задачи списком" },
      { command: "assign_status", description: "Кто что делает по задачам" },
    ] : []),
    { command: "help", description: HELP_COMMAND_DESCRIPTION },
  ];
}

/** Инлайн-меню разделов — экран «Назад» с верхнего уровня раздела. */
export function menuButtons(sections: readonly Section[]): InlineButton[][] {
  const rows: InlineButton[][] = [];
  sections.forEach((s, i) => {
    const button = { text: SECTION_LABEL[s], data: cb(s, "open") };
    if (i % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  return rows;
}

/**
 * Меню команд конкретного человека (scope chat). null — человека убрали:
 * его личное меню удаляется, остаётся общее /help.
 */
export async function setChatCommands(api: Api, chatId: number, zone: Zone | null): Promise<void> {
  const scope = { type: "chat" as const, chat_id: chatId };
  try {
    if (zone === null) {
      await api.deleteMyCommands({ scope });
      return;
    }
    const subject: Subject = { chatId, zone, isOwner: isEnvOwner(chatId) };
    await api.setMyCommands(commandsFor(visibleSections(subject), subject.isOwner), { scope });
  } catch (err) {
    // chat_id в прод-логи не пишем.
    console.error("[databot] setMyCommands:", err instanceof Error ? err.message : String(err));
  }
}
