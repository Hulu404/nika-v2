import { describe, it, expect } from "vitest";
import { COFFEE_RUNS } from "../coffeerun/run";
import { digestText, eveDigestText, morningDigestText } from "./digest-copy";
import type { TeamRun } from "./runs";
import { summarizeSignups, type SignupRow } from "./stats";

/**
 * Сводка приходит человеку, который её не просил. Такое имеет право прийти,
 * только если в первых строках отвечает «что случилось» и «надо ли что-то
 * делать». Это здесь и проверяется.
 */

const RUN: TeamRun = {
  spot: "luzhniki",
  date: "2026-09-20",
  label: "Surf Coffee® Лужники, 20 сентября",
  scheduled: { ...COFFEE_RUNS[0], spot: "luzhniki", date: "2026-09-20" },
  past: false,
};

const NOW = new Date("2026-09-19T08:00:00Z");

function row(over: Partial<SignupRow> = {}): SignupRow {
  return {
    name: "Аня",
    contact: "@anya",
    pace: null,
    created_at: "2026-09-15T09:00:00Z",
    confirmed_at: "2026-09-15T10:00:00Z",
    tg_chat_id: 1,
    reminder_sent_at: null,
    tg_username: "anya",
    ...over,
  };
}

/** Забег, где всё хорошо: напоминания ушли всем. */
const HEALTHY = [
  row({ pace: "6:30", reminder_sent_at: "2026-09-19T07:00:00Z" }),
  row({ pace: "6:30", reminder_sent_at: "2026-09-19T07:01:00Z" }),
  row({ pace: "8:00", reminder_sent_at: "2026-09-19T07:02:00Z" }),
];

describe("утренняя сводка", () => {
  it("первой строкой говорит, что забег сегодня, и называет место", () => {
    const text = morningDigestText(RUN, summarizeSignups(HEALTHY, NOW));
    expect(text.split("\n")[0]).toContain("Сегодня забег");
    expect(text).toContain("Лужники");
    expect(text).toContain("сбор");
  });

  it("даёт разбивку по группам темпа — то, чего не видно на старте", () => {
    const text = morningDigestText(RUN, summarizeSignups(HEALTHY, NOW));
    expect(text).toContain("6:30 мин/км — 2");
    expect(text).toContain("8:00 мин/км — 1");
    // Пустую группу не показываем: пейсеру 7:00 незачем читать про свой ноль.
    expect(text).not.toContain("7:00");
  });

  it("людей без темпа называет отдельно и говорит, что с ними делать", () => {
    const text = morningDigestText(RUN, summarizeSignups([row(), ...HEALTHY], NOW));
    expect(text).toContain("без темпа — 1");
    expect(text).toContain("разведём на месте");
  });

  it("предупреждает про неподтвердившихся: их на старте не ждут", () => {
    const withLost = [...HEALTHY, row({ confirmed_at: null, tg_chat_id: null })];
    const text = morningDigestText(RUN, summarizeSignups(withLost, NOW));
    expect(text).toContain("⚠️ 1 чел.");
    expect(text).toContain("/contacts");
  });

  it("когда все подтвердились — никаких предупреждений", () => {
    expect(morningDigestText(RUN, summarizeSignups(HEALTHY, NOW))).not.toContain("⚠️");
  });
});

describe("вечерняя сводка", () => {
  it("второй по важности строкой отвечает на единственный вопрос: ушли ли напоминания", () => {
    const text = eveDigestText(RUN, summarizeSignups(HEALTHY, NOW), NOW);
    expect(text).toContain("Напоминания ушли: 3 из 3");
  });

  it("про очередь говорит, что она рассосётся сама", () => {
    const partly = [HEALTHY[0], row({ pace: "7:00" })];
    const text = eveDigestText(RUN, summarizeSignups(partly, NOW), NOW);
    expect(text).toContain("Напоминания ушли: 1 из 2");
    expect(text).toContain("Ещё в очереди: 1");
  });

  it("окно прошло, а не ушло ничего — это авария, и выглядит она как авария", () => {
    const nothingSent = [row({ pace: "6:30" }), row({ pace: "7:00" })];
    const text = eveDigestText(RUN, summarizeSignups(nothingSent, NOW), NOW);
    expect(text).toContain("НАПОМИНАНИЯ НЕ УШЛИ");
    expect(text).toContain("подтвердивших 2");
    // И сразу — куда смотреть. Рассылка живёт в процессе сайта, а не отдельно.
    expect(text).toContain("логи приложения");
  });

  it("до окна рассылки не поднимает тревогу — это предпросмотр, а не авария", () => {
    // /digest на забег за неделю до старта иначе кричал бы «НЕ УШЛИ» про
    // рассылку, которой ещё и не должно было быть.
    const early = new Date("2026-09-14T12:00:00Z");
    const text = eveDigestText(RUN, summarizeSignups(HEALTHY, early), early);
    expect(text).not.toContain("НЕ УШЛИ");
    expect(text).toContain("окно откроется накануне");
  });

  it("ноль подтвердивших — это не авария, а пустой забег", () => {
    // Слать «НАПОМИНАНИЯ НЕ УШЛИ» туда, где некому напоминать, — ложная тревога.
    const nobody = [row({ confirmed_at: null, tg_chat_id: null })];
    const text = eveDigestText(RUN, summarizeSignups(nobody, NOW), NOW);
    expect(text).not.toContain("НЕ УШЛИ");
    expect(text).toContain("Напоминания ушли: 0 из 0");
  });
});

describe("digestText", () => {
  it("разводит два вида по их текстам", () => {
    const stats = summarizeSignups(HEALTHY, NOW);
    expect(digestText("morning", RUN, stats)).toBe(morningDigestText(RUN, stats));
    expect(digestText("eve", RUN, stats, NOW)).toBe(eveDigestText(RUN, stats, NOW));
  });

  it("забег без расписания не роняет сводку", () => {
    // Такого в штатном потоке быть не должно (сводки идут по будущим забегам),
    // но падать на этом посреди рассылки — худший из вариантов.
    const orphan: TeamRun = { ...RUN, scheduled: null, past: true };
    expect(() => digestText("morning", orphan, summarizeSignups(HEALTHY, NOW))).not.toThrow();
    expect(() => digestText("eve", orphan, summarizeSignups(HEALTHY, NOW), NOW)).not.toThrow();
  });
});
