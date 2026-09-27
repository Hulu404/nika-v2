import { parseCallback } from "./callback";
import { sectionByLabel } from "./copy";
import { inviteTokenFromStart } from "./invite";
import { SECTION_COMMAND, SECTION_HOME_REPORT } from "./sections";
import type { Intent, Section } from "./types";
import { isChatId, isZone } from "./validate";

/**
 * Разбор апдейта в Intent: кнопка постоянной клавиатуры, команда или
 * callback. Вопрос текстом до Промта 14 не разбирается и ведёт в меню
 * (report unknown).
 *
 * Параметры callback проверяются теми же валидаторами (validate.ts), что
 * потом будут у текста. Не прошли — кнопка устарела (stale), а не ошибка.
 */
export type ParseResult =
  | { kind: "intent"; intent: Intent }
  /** Кнопку уже нельзя выполнить; section — куда вернуть человека. */
  | { kind: "stale"; section: Section | null };

const COMMAND_TO_SECTION = new Map<string, Section>(
  (Object.entries(SECTION_COMMAND) as [Section, string][]).map(([s, c]) => [c, s]),
);

export function parseIntent(input: { text?: string | null; callbackData?: string | null }): ParseResult {
  if (input.callbackData !== undefined && input.callbackData !== null) {
    return parseCallbackIntent(input.callbackData);
  }
  return parseTextIntent(input.text ?? "");
}

function intent(partial: Omit<Intent, "params"> & { params?: Record<string, string> }): ParseResult {
  return { kind: "intent", intent: { params: {}, ...partial } };
}

function sectionHome(section: Section, source: Intent["source"]): ParseResult {
  return intent({ report: SECTION_HOME_REPORT[section], section, action: "list", source });
}

// ─────────────────────────────────────────────────────────────────────────────
// Текст: команды и кнопки постоянной клавиатуры
// ─────────────────────────────────────────────────────────────────────────────

function parseTextIntent(raw: string): ParseResult {
  const text = raw.trim();

  if (text.startsWith("/")) {
    const [head, ...rest] = text.split(/\s+/);
    // /runs@ИмяБота — так команды приходят из меню в некоторых клиентах.
    const command = head.slice(1).split("@")[0].toLowerCase();
    const payload = rest.join(" ");

    if (command === "start") {
      const token = inviteTokenFromStart(payload);
      return intent({ report: "start", section: null, action: "start", source: "command", params: token ? { invite: token } : {} });
    }
    if (command === "help") return intent({ report: "help", section: null, action: "help", source: "command" });
    if (command === "cancel") return intent({ report: "menu", section: null, action: "cancel", source: "command" });

    const section = COMMAND_TO_SECTION.get(command);
    if (section) return sectionHome(section, "command");

    return intent({ report: "unknown", section: null, action: "unknown", source: "command", rawText: text });
  }

  const section = sectionByLabel(text);
  if (section) return sectionHome(section, "button");

  return intent({ report: "unknown", section: null, action: "unknown", source: "text", rawText: text });
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback
// ─────────────────────────────────────────────────────────────────────────────

function parseCallbackIntent(data: string): ParseResult {
  const parsed = parseCallback(data);
  if (!parsed) return { kind: "stale", section: null };
  const { section, action, params } = parsed;

  // Общие для всех разделов: «Назад» в меню и открыть раздел из меню.
  if (action === "home" && params.length === 0) {
    return intent({ report: "menu", section, action: "home", source: "button" });
  }
  if (action === "open" && params.length === 0) return sectionHome(section, "button");

  if (section === "tm") return parseTeamCallback(action, params);

  // Остальные разделы подключаются своими промтами; до тех пор их кнопок
  // быть не может, и любая такая кнопка — устаревшая.
  return { kind: "stale", section };
}

/**
 * «Команда»:
 *   d:tm:list · d:tm:usage · d:tm:inv[:<zone>] · d:tm:zone:<id>[:<zone>] · d:tm:rm:<id>[:ok]
 */
function parseTeamCallback(action: string, params: string[]): ParseResult {
  const stale: ParseResult = { kind: "stale", section: "tm" };
  const tm = (report: Intent["report"], act: string, p: Record<string, string> = {}) =>
    intent({ report, section: "tm", action: act, source: "button", params: p });

  switch (action) {
    case "list":
      return params.length === 0 ? tm("tm.list", "list") : stale;
    case "usage":
      return params.length === 0 ? tm("tm.usage", "usage") : stale;
    case "inv":
      if (params.length === 0) return tm("tm.invite", "invite");
      if (params.length === 1 && isZone(params[0])) return tm("tm.invite", "invite", { zone: params[0] });
      return stale;
    case "zone": {
      const [target, zone, ...extra] = params;
      if (!target || !isChatId(target) || extra.length) return stale;
      if (zone === undefined) return tm("tm.zone", "zone", { target });
      return isZone(zone) ? tm("tm.zone", "zone", { target, zone }) : stale;
    }
    case "rm": {
      const [target, confirm, ...extra] = params;
      if (!target || !isChatId(target) || extra.length) return stale;
      if (confirm === undefined) return tm("tm.remove", "remove", { target });
      return confirm === "ok" ? tm("tm.remove", "remove", { target, confirm }) : stale;
    }
    default:
      return stale;
  }
}
