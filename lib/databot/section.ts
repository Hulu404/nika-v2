import type { DatabotStore } from "./data/store";
import type { Intent, MemberRow, Screen, Subject, Zone } from "./types";

/**
 * Контракт между конвейером и обработчиками разделов. Конвейер уже проверил
 * лимит, членство, зону и параметры; обработчик только строит экран.
 */

/** Побочные действия в Telegram, которые нужны разделам. */
export interface DatabotEffects {
  /** Меню команд человека по зоне (scope chat); null — удалить (убранный). */
  setCommands(chatId: number, zone: Zone | null): Promise<void>;
}

export interface SectionRequest {
  subject: Subject;
  member: MemberRow;
  intent: Intent;
  store: DatabotStore;
  effects: DatabotEffects;
  now: Date;
  /** username бота из getMe — для ссылок-приглашений. */
  botUsername: string;
}

export type SectionOutcome =
  /** Экран. Первый заменяет сообщение с кнопкой (если запрос — callback), остальные — новыми. */
  | {
      kind: "screens";
      screens: Screen[];
      /**
       * Снять кнопки с сообщения, которое нажали («Ещё» у защищённого списка):
       * второе нажатие той же кнопки не пришлёт ту же страницу повторно.
       */
      consumeButton?: boolean;
    }
  /** Кнопку уже нельзя выполнить (человек убран, приглашение пропало). */
  | { kind: "stale" };

export type SectionHandler = (req: SectionRequest) => Promise<SectionOutcome>;
