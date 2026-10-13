import { describe, expect, it } from "vitest";
import { fillDefaults, parseTimeAnswer } from "./clarify";
import type { Intent } from "./intent";
import type { TeamMember } from "../access";
import { ROSTER } from "../roster";

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
  const team: TeamMember[] = ROSTER.map((r, i) => ({
    chat_id: i + 1, username: r.username, display_name: r.firstName, role: "member", joined_at: "2026-10-01T00:00:00Z",
    added_by: null, last_seen_at: null, digest_opt_in: true, first_name: r.firstName, title: r.title,
    departments: r.departments, name_aliases: r.aliases,
  }));
  const ALI = 8;
  const event = (patch: Partial<Extract<Intent, { intent: "create_event" }>>): Extract<Intent, { intent: "create_event" }> =>
    ({ intent: "create_event", title: "", starts_at: "2026-10-14T16:00", place: null, participants: [], kind: "meeting", ...patch });
  const mention = (name: string, qualifier: string | null = null) => ({ name, qualifier });
  const fill = (e: Intent, text: string) => fillDefaults(e, text, team, ALI) as Extract<Intent, { intent: "create_event" }>;

  it("«созвон с ивент отделом с машей и сальва в 21 30» — «Созвон с ивент-отделом», участники = отдел", () => {
    const res = fill(event({ title: "Созвон с Маше и Сальме", participants: [mention("ивент отделом"), mention("машей"), mention("сальва")] }),
      "Поставь на сегодня созвон с ивент отделом с машей и сальва в 21 30");
    expect(res.title).toBe("Созвон с ивент-отделом");
    expect(res.participants).toEqual([mention("ивент отделом")]);
    expect(res.place).toBe("Онлайн");
  });

  it("«встреча завтра в 16 с Машей из ивента и Сальмой» — «Встреча с Машей и Сальмой»", () => {
    expect(fill(event({ title: "Встреча", participants: [mention("Машей", "из ивента"), mention("Сальмой")] }),
      "встреча завтра в 16 с Машей из ивента и Сальмой").title).toBe("Встреча с Машей и Сальмой");
  });

  it("«сбивка по дизайну с Машей-дизайнером в 12» — название «Сбивка по дизайну»", () => {
    expect(fill(event({ title: "Сбивка по дизайну с Машей", participants: [mention("Машей-дизайнером")] }),
      "сбивка по дизайну с Машей-дизайнером в 12").title).toBe("Сбивка по дизайну");
  });

  it("больше двух людей — список без предлога; первое слово — из речи", () => {
    expect(fill(event({ participants: [mention("Машей", "из ивента"), mention("Сальмой"), mention("Викой", "из смм")] }),
      "планёрка с Машей из ивента, Сальмой и Викой из смм").title).toBe("Планёрка: Маша, Сальма, Вика");
    expect(fill(event({ participants: [mention("Диме")] }), "сбивка с Димой").title).toBe("Сбивка с Дмитрием");
  });

  it("никого — вид встречи; место «Онлайн»/«Zoom», если другое не сказано", () => {
    expect(fill(event({}), "созвон завтра в 16")).toMatchObject({ title: "Созвон", place: "Онлайн" });
    expect(fill(event({}), "встреча в зуме завтра")).toMatchObject({ title: "Встреча", place: "Zoom" });
    expect(fill(event({ title: "Сбивка по дизайну", place: "переговорная" }), "сбивка по дизайну в зуме"))
      .toMatchObject({ title: "Сбивка по дизайну", place: "переговорная" });
    expect(fill(event({ participants: [mention("Сальмой"), mention("со мной")] }), "встреча с Сальмой и со мной").title).toBe("Встреча с Сальмой");
  });

  it("текст напоминания — всё после «напомни мне»", () => {
    const r: Intent = { intent: "create_reminder", text: "", remind_at: "", task_hint: null, missing: ["remind_at"] };
    expect(fillDefaults(r, "Напомни мне позвонить в Surf")).toMatchObject({ text: "позвонить в Surf" });
    expect(fillDefaults(r, "напомни")).toMatchObject({ text: "Напоминание" });
  });
});
