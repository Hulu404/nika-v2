import { describe, it, expect } from "vitest";
import {
  BUTTONS,
  TEXT,
  WEEKDAY_SHORT,
  participantMessage,
  resultMessage,
  type SurveyMessage,
} from "./club-survey-copy";
import type { OutKind } from "../clubs/survey-flow";
import type { SurveyResultRow } from "../clubs/survey-store";
import { YOGA, consentedRow } from "../../test/club-survey-row";

/**
 * Страж глоссария NIKA для ВСЕХ текстов участнику и подписей кнопок
 * (docs/club-survey.md, «Правила текстов участнику»). Служебные реплики
 * организатору сюда не входят намеренно.
 *
 * В JS \b с кириллицей не работает, поэтому граница слова — [^а-яё] (флаг i).
 * Запрещённые слова ловим по основе в начале слова: «медитации» — тоже нельзя.
 */

const B = "(?:^|[^а-яё])";
const E = "(?=$|[^а-яё])";

const FORBIDDEN_STEMS = [
  "нейросет",
  "ии-ассистент",
  "инновацион",
  "уникальн",
  "революцион",
  "платформ",
  "экосистем",
  "гармони",
  "баланс",
  "проработ",
  "отпуст",
  "бесплатн",
  "любител",
  "начинающ",
  "терапи",
  "лечит",
  "аудитори",
  "подписчик",
  "юзер",
  "тусовк",
  "медитаци",
];

const RULES: [string, RegExp][] = [
  ["отдельное «не»", new RegExp(`${B}не${E}`, "i")],
  ["длинное тире", /—/],
  ["стрелки", /[←→↑↓↔⇐⇒⇔➔➜➡⟶⟵]|->|=>/],
  ["формы с родом вроде «отметил(а)»", /[а-яё]\((а|я|ла|на|ый|ая)\)/i],
  ["NIKA кириллицей", new RegExp(`${B}ник(а|и|е|у|ой)${E}`, "i")],
  ["«кофе-ран» с заглавной", /Кофе-ран/],
  ["«кофе-ран» без дефиса", new RegExp(`${B}кофе\\s*ран`, "i")],
  ...FORBIDDEN_STEMS.map((stem): [string, RegExp] => [`«${stem}…»`, new RegExp(`${B}${stem}`, "i")]),
];

const URL = "https://www.mynika.online/legal/consent";
const THU = "2026-10-29";
const SAT = "2026-10-31";
const RESULT: SurveyResultRow = {
  id: 7,
  survey_key: "yoga",
  meet_date: THU,
  meet_time: "19:30",
  place: "студия, адрес",
  bring: "удобную одежду и воду",
  created_at: "2026-10-23T09:00:00Z",
  confirmed_at: "2026-10-23T09:05:00Z",
};

/** Строки-примеры, на которых собираются все сообщения. */
const ROWS = [
  consentedRow({ attend: "come", days: [THU], wd_from: "19:00", wd_to: "21:00", time_q: "all" }),
  consentedRow({ attend: "come", days: [THU, SAT], wd_from: "19:00", wd_to: "21:00", we_from: "11:00", we_to: "14:00", time_q: "wd" }),
  consentedRow({ attend: "come", days: [THU, SAT], wd_any: true, we_any: true, time_q: "we" }),
  consentedRow({ attend: "come", days: [SAT], we_raw: "как получится", time_q: "all" }),
  consentedRow({ attend: "later", weekdays: [1, 3, 6], time_q: "wd" }),
  consentedRow({
    attend: "come",
    days: [THU, SAT],
    time_q: "wd",
    day_times: { "6": { from: "11:00", to: "14:00" } },
  }),
  consentedRow({ attend: "come", days: [THU, SAT], day_times: { "4": { any: true }, "6": { from: "11:00", to: "14:00" } } }),
];

const KINDS: OutKind[] = [
  "interest",
  "skipped",
  "consent",
  "declined",
  "attend",
  "days",
  "days_empty",
  "later",
  "time",
  "time_retry",
  "time_short",
  "time_saved",
  "time_other_days",
  "done",
  "later_done",
  "result_yes",
  "result_no",
];

function keyboardLabels(msg: SurveyMessage): string[] {
  return (msg.keyboard?.inline_keyboard ?? []).flat().map((b) => b.text);
}

/** Всё, что видит участник: тексты, подписи кнопок, подставленные значения. */
function participantStrings(): [string, string][] {
  const out: [string, string][] = [];
  for (const row of ROWS) {
    for (const kind of KINDS) {
      const msg = participantMessage(kind, YOGA, row, URL);
      if (!msg) throw new Error(`нет текста для ${kind}`);
      out.push([kind, msg.text], ...keyboardLabels(msg).map((l): [string, string] => [`${kind}: кнопка`, l]));
    }
  }
  for (const variant of ["match", "nomatch"] as const) {
    for (const r of [RESULT, { ...RESULT, bring: null }]) {
      const msg = resultMessage(YOGA, r, variant);
      out.push([`итог ${variant}`, msg.text], ...keyboardLabels(msg).map((l): [string, string] => ["итог: кнопка", l]));
    }
  }
  out.push(["7", TEXT.reminder(YOGA)], ["12", TEXT.eve(RESULT)]);
  out.push(...Object.values(BUTTONS).map((b): [string, string] => ["кнопка", b]));
  out.push(...WEEKDAY_SHORT.map((d): [string, string] => ["день недели", d]));
  out.push(...YOGA.days.map((d): [string, string] => ["день", d.label]));
  out.push(["подпись недели", YOGA.weekLabel], ["подпись итога", YOGA.resultLabel], ["срок", YOGA.voteDeadlineLabel]);
  return out;
}

describe("страж глоссария: тексты участнику", () => {
  const strings = participantStrings();

  it("покрывает все виды сообщений и кнопки", () => {
    expect(strings.length).toBeGreaterThan(100);
  });

  it.each(RULES)("нет: %s", (_name, re) => {
    const hits = strings.filter(([, s]) => re.test(s)).map(([where, s]) => `${where}: ${s}`);
    expect(hits).toEqual([]);
  });

  it("NIKA — латиницей", () => {
    expect(TEXT.interest).toContain("NIKA");
    expect(TEXT.skipped).toContain("NIKA");
  });
});

describe("страж сам ловит нарушения", () => {
  const caught = (s: string) => RULES.filter(([, re]) => re.test(s)).map(([name]) => name);

  it.each([
    ["Это не страшно", "отдельное «не»"],
    ["Не забудь", "отдельное «не»"],
    ["клуб — это", "длинное тире"],
    ["дальше → сюда", "стрелки"],
    ["ты отметил(а)", "формы с родом вроде «отметил(а)»"],
    ["команда НИКА", "NIKA кириллицей"],
    ["Кофе-ран в субботу", "«кофе-ран» с заглавной"],
    ["наш кофе ран", "«кофе-ран» без дефиса"],
    ["Медитации по утрам", "«медитаци…»"],
    ["бесплатно", "«бесплатн…»"],
  ])("«%s»", (s, rule) => {
    expect(caught(s)).toContain(rule);
  });

  it("не путает «не» внутри слов и «Ника»-подобные слова", () => {
    expect(caught("неделя занята, нежно, тебе")).toEqual([]);
    expect(caught("техника и паника")).toEqual([]);
  });
});
