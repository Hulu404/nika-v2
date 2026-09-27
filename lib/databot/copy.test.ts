import { describe, expect, it } from "vitest";
import { callbackBytes, CALLBACK_MAX_BYTES } from "./callback";
import {
  DB_DOWN_TEXT,
  NOT_READY_TEXT,
  RATE_LIMIT_TEXT,
  REPORT_LABEL,
  SECTION_COMMAND_DESCRIPTION,
  SECTION_LABEL,
  STALE_TEXT,
  STRANGER_TEXT,
  ZONE_LABEL,
  forbiddenText,
  helpText,
  inviteExpiredText,
  menuText,
  sectionByLabel,
  teamInviteForwardScreen,
  teamListScreen,
  teamRemoveConfirmScreen,
  teamZonePickScreen,
  welcomeText,
} from "./copy";
import { REPORTS, SECTIONS, ZONES, type Screen } from "./types";

/**
 * Тексты бота данных: дословные формулировки из ТЗ, экранирование и
 * полнота подписей. К базе copy.ts не обращается — тестам моки не нужны.
 */

const EVIL = `<b>Ева</b> & "Ко"`;
const buttonsData = (s: Screen) => (s.buttons ?? []).flat().map((b) => b.data);

describe("формулировки из ТЗ — дословно", () => {
  it("доступ, лимит, авария, устаревший экран, неготовый раздел", () => {
    expect(STRANGER_TEXT).toBe("Это внутренний бот команды НИКИ. Доступ по приглашению.");
    expect(RATE_LIMIT_TEXT).toBe("Слишком часто, подожди минуту");
    expect(DB_DOWN_TEXT).toBe("Не получилось достать данные, база не ответила. Попробуй через минуту");
    expect(STALE_TEXT).toBe("Этот экран устарел");
    expect(NOT_READY_TEXT).toBe("Этот раздел ещё собираю");
  });

  it("устаревшее приглашение — с именем пригласившего, экранированным", () => {
    expect(inviteExpiredText("Ева")).toBe("Ссылка устарела, попроси новую у Ева");
    expect(inviteExpiredText(EVIL)).not.toContain("<b>");
    expect(inviteExpiredText(EVIL)).toContain("&lt;b&gt;Ева&lt;/b&gt; &amp;");
    expect(inviteExpiredText(null)).toBe("Ссылка устарела, попроси новую у владельца бота");
  });
});

describe("отказ по зоне", () => {
  it("один раздел: «Это видит совет. Тебе доступны: …»", () => {
    expect(forbiddenText(["council"], ["run", "tr", "kb"])).toBe(
      "Это видит совет. Тебе доступны: Забеги, Соцсети, Справочник.",
    );
  });

  it("две зоны — «видят совет и ивенты»", () => {
    expect(forbiddenText(["council", "events"], ["run"])).toBe("Это видят совет и ивенты. Тебе доступны: Забеги.");
  });

  it("только владелец", () => {
    expect(forbiddenText("owner", ["tm"])).toMatch(/^Это может только владелец бота\./);
  });

  it("доступных разделов пока нет — честно так и пишем", () => {
    expect(forbiddenText(["council"], [])).toBe("Это видит совет. Твои разделы ещё собираю.");
  });
});

describe("меню, вход, помощь", () => {
  it("зона называется по-человечески, разделы перечислены", () => {
    const w = welcomeText("events", ["run", "tr"]);
    expect(w).toContain("Твоя зона — Ивенты.");
    expect(w).toContain("Разделы: Забеги, Соцсети.");
    expect(menuText("council", ["tm"])).toContain("Зона — Совет.");
  });

  it("без готовых разделов — не пустая строка, а объяснение", () => {
    expect(welcomeText("smm", [])).toContain("ещё собираю");
  });

  it("/help перечисляет команды и /cancel", () => {
    const h = helpText("council", ["tm"], ["team", "help"]);
    expect(h).toContain("/team /help");
    expect(h).toContain("/cancel");
  });

  it("кнопка клавиатуры узнаётся по подписи, чужой текст — нет", () => {
    for (const s of SECTIONS) expect(sectionByLabel(SECTION_LABEL[s])).toBe(s);
    expect(sectionByLabel("  Команда ")).toBe("tm");
    expect(sectionByLabel("команда")).toBeNull();
    expect(sectionByLabel("сколько на субботу")).toBeNull();
  });
});

describe("полнота подписей", () => {
  it("у каждой зоны, раздела и отчёта есть подпись", () => {
    for (const z of ZONES) expect(ZONE_LABEL[z]).toBeTruthy();
    for (const s of SECTIONS) {
      expect(SECTION_LABEL[s]).toBeTruthy();
      expect(SECTION_COMMAND_DESCRIPTION[s]).toBeTruthy();
    }
    for (const r of REPORTS) expect(REPORT_LABEL[r]).toBeTruthy();
  });

  it("подписи кнопок клавиатуры не повторяются", () => {
    const labels = SECTIONS.map((s) => SECTION_LABEL[s]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("глоссарий: нет «Free» и «чат» вместо «Диалог»", () => {
    const all = [...Object.values(SECTION_LABEL), ...Object.values(REPORT_LABEL), ...Object.values(SECTION_COMMAND_DESCRIPTION)];
    for (const t of all) {
      expect(t).not.toMatch(/Free/);
      expect(t.toLowerCase()).not.toMatch(/\bчат\b/);
    }
  });
});

describe("экраны «Команды»", () => {
  const now = new Date("2026-10-01T09:00:00Z");
  const member = {
    chatId: 4503599627370495,
    name: EVIL,
    username: "eva_test",
    zone: "events" as const,
    isOwner: false,
    lastSeenAt: null,
    requests7d: 3,
    manageable: true,
  };

  it("имя экранировано везде, где оно в HTML", () => {
    const screens = [
      teamListScreen({ members: [member], canInvite: true, now }),
      teamZonePickScreen({ chatId: member.chatId, name: EVIL, zone: "events" }),
      teamRemoveConfirmScreen({ chatId: member.chatId, name: EVIL }),
    ];
    for (const s of screens) {
      expect(s.text).not.toContain("<b>Ева</b>");
      expect(s.text).toContain("&lt;b&gt;Ева&lt;/b&gt;");
    }
  });

  it("все кнопки — d:tm:… и не длиннее 64 байт даже с chat_id на 16 цифр", () => {
    const screens = [
      teamListScreen({ members: [member], canInvite: true, now }),
      teamZonePickScreen({ chatId: member.chatId, name: EVIL, zone: "events" }),
      teamRemoveConfirmScreen({ chatId: member.chatId, name: EVIL }),
    ];
    for (const data of screens.flatMap(buttonsData)) {
      expect(data.startsWith("d:tm:")).toBe(true);
      expect(callbackBytes(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    }
  });

  it("список без права управления — без «Пригласить», «Зона», «Убрать»", () => {
    const s = teamListScreen({ members: [{ ...member, manageable: false }], canInvite: false, now });
    const data = buttonsData(s);
    expect(data).toEqual(["d:tm:usage", "d:tm:home"]);
  });

  it("текст для пересылки — со ссылкой и сроком, без кнопок", () => {
    const s = teamInviteForwardScreen("smm", "https://t.me/test_databot?start=inv_" + "a".repeat(32));
    expect(s.text).toContain("?start=inv_");
    expect(s.text).toContain("48 часов");
    expect(s.buttons).toBeUndefined();
  });
});
