import { describe, expect, it } from "vitest";
import { fillDefaults, parseTimeAnswer } from "./clarify";
import type { Intent } from "./intent";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-13T14:05"); // вт 13.10

describe("время из ответа — кодом, без модели", () => {
  const cases: Array<[string, string | null, string | null]> = [
    ["в 18", "2026-10-13", "2026-10-13T18:00"],
    ["18:00", "2026-10-13", "2026-10-13T18:00"],
    ["в 18 30", "2026-10-13", "2026-10-13T18:30"],
    ["18.45", null, "2026-10-13T18:45"],
    ["в шесть вечера", "2026-10-13", "2026-10-13T18:00"],
    ["в 10 утра", "2026-10-16", "2026-10-16T10:00"],
    ["в 6", "2026-10-13", "2026-10-13T18:00"],
    ["через час", null, "2026-10-13T15:05"],
    ["через 2 часа", null, "2026-10-13T16:05"],
    ["через 30 минут", null, "2026-10-13T14:35"],
    ["через полчаса", null, "2026-10-13T14:35"],
    ["завтра в 10", null, "2026-10-14T10:00"],
    ["в полдень", "2026-10-15", "2026-10-15T12:00"],
    ["пт 18:00", null, "2026-10-16T18:00"],
    ["в пятницу в 12", null, "2026-10-16T12:00"],
    ["во вторник в 10", null, "2026-10-20T10:00"],
    ["созвон", "2026-10-13", null],
    ["не знаю", null, null],
  ];
  for (const [text, base, expected] of cases) {
    it(`«${text}» → ${expected}`, () => expect(parseTimeAnswer(text, base, NOW)).toBe(expected));
  }

  it("без сказанного дня прошедший час — завтра", () => {
    expect(parseTimeAnswer("в 10", null, NOW)).toBe("2026-10-14T10:00");
  });
});

describe("подстановки вместо вопросов", () => {
  const event = (patch: Partial<Extract<Intent, { intent: "create_event" }>>): Intent =>
    ({ intent: "create_event", title: "", starts_at: "2026-10-14T16:00", place: null, participants: [], kind: "meeting", ...patch });

  it("название встречи — из сказанного, место — «Онлайн»/«Zoom»", () => {
    expect(fillDefaults(event({ title: "Онлайн-встреча", participants: [{ name: "ивент-отделом", qualifier: null }] }), "онлайн-встречу с ивент-отделом"))
      .toMatchObject({ title: "Встреча с ивент-отделом", place: "Онлайн" });
    expect(fillDefaults(event({}), "созвон завтра в 16")).toMatchObject({ title: "Созвон", place: "Онлайн" });
    expect(fillDefaults(event({}), "встреча в зуме завтра")).toMatchObject({ title: "Встреча", place: "Zoom" });
    expect(fillDefaults(event({ title: "Сбивка по дизайну", place: "переговорная" }), "сбивка по дизайну в зуме"))
      .toMatchObject({ title: "Сбивка по дизайну", place: "переговорная" });
    expect(fillDefaults(event({ participants: [{ name: "Сальмой", qualifier: null }, { name: "со мной", qualifier: null }] }), "встреча с Сальмой и со мной"))
      .toMatchObject({ title: "Встреча с Сальмой" });
  });

  it("текст напоминания — всё после «напомни мне»", () => {
    const r: Intent = { intent: "create_reminder", text: "", remind_at: "", task_hint: null, missing: ["remind_at"] };
    expect(fillDefaults(r, "Напомни мне позвонить в Surf")).toMatchObject({ text: "позвонить в Surf" });
    expect(fillDefaults(r, "напомни")).toMatchObject({ text: "Напоминание" });
  });
});
