import { InlineKeyboard } from "grammy";
import { SCENARIO_ORDER, SCENARIO_META } from "./scenarios";

/**
 * Главное меню: 5 кнопок сценариев (по одной в строке для читаемости).
 */
export function menuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const scenario of SCENARIO_ORDER) {
    kb.text(SCENARIO_META[scenario].label, `scenario:${scenario}`).row();
  }
  return kb;
}

/**
 * Кнопка под каждым ответом НИКИ во время диалога.
 * Позволяет сменить сценарий или вернуться в меню.
 */
export function chatKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("← Сменить сценарий", "back_to_menu");
}
