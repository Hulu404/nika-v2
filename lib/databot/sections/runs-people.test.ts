import { describe, expect, it } from "vitest";
import type { ArchiveRow } from "../../team/history";
import { signupStatus } from "../../team/stats";
import { PEOPLE_HEADER, PEOPLE_PAGE_SIZE, runsCsv, runsCsvFilename } from "../copy";
import { MemoryStore } from "../data/memory-store";
import type { RosterRow, RunsTableRow } from "../data/runs";
import type { SectionRequest } from "../section";
import type { Intent, MemberRow, Screen, Subject } from "../types";
import { createRunsHandler, orderRoster, type RunsDeps } from "./runs";

/**
 * «Забеги», Промт 6: список участников, план явки, таблица и CSV. Чтение
 * подменено, статусы и порядок — настоящими функциями lib/team.
 */

const SPOT = "luzhniki";
const RUN = "2026-10-03";
const NOW = new Date("2026-09-30T11:32:00Z"); // 14:32 МСК, за 3 дня до старта
const iso = (s: string) => new Date(s).toISOString();

/** Архив, где забег RUN существует (одна заявка), и прошедший 26.09. */
const ARCHIVE: ArchiveRow[] = [
  { spot: SPOT, run_date: RUN, created_at: iso("2026-09-25T10:00:00Z"), confirmed_at: null, reminder_sent_at: null },
  { spot: SPOT, run_date: "2026-09-26", created_at: iso("2026-09-20T10:00:00Z"), confirmed_at: null, reminder_sent_at: null },
];

function deps(over: Partial<RunsDeps> = {}): RunsDeps {
  return {
    fetchArchive: async () => ARCHIVE,
    fetchRunSignups: async () => [],
    fetchRunPeople: async () => ({ total: 0, newPeople: 0, returningPeople: 0, byLink: {} }),
    fetchRunPlan: async () => null,
    fetchRunRoster: async () => [],
    setRunPlan: async () => {},
    fetchRunsTable: async () => [],
    ...over,
  };
}

const member: MemberRow = {
  chat_id: 1,
  username: null,
  display_name: "Тест",
  zone: "events",
  is_owner: false,
  invited_by: null,
  joined_at: iso("2026-09-01"),
  last_seen_at: null,
  is_active: true,
  removed_at: null,
};

function req(action: string, params: Record<string, string>, zone: Subject["zone"] = "events"): SectionRequest {
  const intent: Intent = { report: "run.people", section: "run", action, params, source: "button" };
  return {
    subject: { chatId: 1, zone, isOwner: false },
    member: { ...member, zone },
    intent,
    store: new MemoryStore(),
    effects: { setCommands: async () => {} },
    now: NOW,
    botUsername: "test_databot",
  };
}

async function screens(d: RunsDeps, r: SectionRequest): Promise<Screen[]> {
  const out = await createRunsHandler(d)(r);
  if (out.kind !== "screens") throw new Error("ждали экран, а не stale");
  return out.screens;
}

const buttonData = (s: Screen) => (s.buttons ?? []).flat().map((b) => b.data);

function roster(n: number, over: (i: number) => Partial<RosterRow> = () => ({})): RosterRow[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Участник ${i}`,
    nick: `nick${i}`,
    pace: "7:00",
    createdAt: iso(`2026-09-2${i % 9}T10:00:00Z`),
    confirmedAt: null,
    reminderSentAt: null,
    tgLinked: false,
    isNew: false,
    ...over(i),
  }));
}

describe("список участников", () => {
  it("статусы и порядок — функциями lib/team: ⚠️ → ⏳ → ✅, внутри — по времени заявки", () => {
    const base = roster(1)[0];
    const ordered = orderRoster([
      { ...base, name: "Поздний ✅", createdAt: iso("2026-09-25T12:00:00Z"), reminderSentAt: iso("2026-10-02T07:00:00Z") },
      { ...base, name: "Ранний ✅", createdAt: iso("2026-09-20T12:00:00Z"), reminderSentAt: iso("2026-10-02T07:00:00Z") },
      { ...base, name: "⏳", confirmedAt: iso("2026-09-26T12:00:00Z"), tgLinked: true },
      // Подтвердил, но без чата — lib/team считает его неподтверждённым.
      { ...base, name: "⚠️ без чата", confirmedAt: iso("2026-09-26T12:00:00Z"), tgLinked: false },
    ]);
    expect(ordered.map((r) => r.name)).toEqual(["⚠️ без чата", "⏳", "Ранний ✅", "Поздний ✅"]);
    for (const r of ordered) expect(r.status).toBe(signupStatus(r));
  });

  it("шапка приватности, экранирование, «впервые», без телефона и email; защищено", async () => {
    const rows = roster(2, (i) => (i === 0 ? { name: "<b>Аня</b> & Ко", nick: "anya", isNew: true } : {}));
    const [s] = await screens(deps({ fetchRunRoster: async () => rows }), req("people", { spot: SPOT, date: RUN, page: "1" }));
    expect(s.protect).toBe(true);
    expect(s.text.startsWith(`<b>${PEOPLE_HEADER}</b>`)).toBe(true);
    expect(s.text).toContain("⚠️ &lt;b&gt;Аня&lt;/b&gt; &amp; Ко @anya · 7:00 · впервые");
    expect(s.text).not.toMatch(/@\S+\.\S+|\+7|\d{10}/);
  });

  it("в строке списка нет полей для телефона и email вообще", () => {
    // Тип RosterRow — то, что отдаёт databot_run_roster; contact и email в нём нет.
    const keys = Object.keys(roster(1)[0]).sort();
    expect(keys).toEqual(["confirmedAt", "createdAt", "isNew", "name", "nick", "pace", "reminderSentAt", "tgLinked"]);
  });

  it("по 30 человек, «Ещё» — следующая страница, со второй кнопка у прошлой снимается", async () => {
    const d = deps({ fetchRunRoster: async () => roster(PEOPLE_PAGE_SIZE + 5) });
    const first = await createRunsHandler(d)(req("people", { spot: SPOT, date: RUN, page: "1" }));
    if (first.kind !== "screens") throw new Error();
    expect(first.consumeButton).toBeFalsy();
    const p1 = first.screens[0];
    expect(p1.text.split("\n").filter((l) => l.startsWith("⚠️ Участник")).length).toBe(PEOPLE_PAGE_SIZE);
    expect(buttonData(p1)).toContain(`d:run:people:${SPOT}:${RUN}:2`);

    const second = await createRunsHandler(d)(req("people", { spot: SPOT, date: RUN, page: "2" }));
    if (second.kind !== "screens") throw new Error();
    expect(second.consumeButton).toBe(true);
    const p2 = second.screens[0];
    expect(p2.protect).toBe(true);
    expect(p2.text).toContain(PEOPLE_HEADER);
    expect(p2.text.split("\n").filter((l) => l.startsWith("⚠️ Участник")).length).toBe(5);
    expect(buttonData(p2).some((x) => x.includes(":people:"))).toBe(false);
  });

  it("забега нет — экран устарел", async () => {
    const out = await createRunsHandler(deps())(req("people", { spot: SPOT, date: "2027-01-01", page: "1" }));
    expect(out).toEqual({ kind: "stale" });
  });
});

describe("план явки", () => {
  it("открывает форму на 10 минут в tg_sessions", async () => {
    const r = req("plan", { spot: SPOT, date: RUN });
    const [s] = await screens(deps(), r);
    expect(s.text).toMatch(/^Сколько человек считаем полной точкой\? Пришли число от 5 до 200/);
    const form = await r.store.getForm(1);
    expect(form).toMatchObject({ kind: "run.plan", params: { spot: SPOT, date: RUN } });
    expect(Date.parse(form!.expiresAt) - NOW.getTime()).toBe(10 * 60 * 1000);
  });

  it("число от 5 до 200 — записываем, закрываем форму, показываем карточку с процентом", async () => {
    const saved: unknown[] = [];
    let plan: number | null = null;
    const signups = Array.from({ length: 23 }, () => ({
      name: "x", contact: "", pace: null, created_at: iso("2026-09-25T10:00:00Z"),
      confirmed_at: null, reminder_sent_at: null, tg_username: null, tg_chat_id: null,
    }));
    const r = req("plan_submit", { spot: SPOT, date: RUN, value: "25" });
    await r.store.setForm(1, { kind: "run.plan", params: { spot: SPOT, date: RUN }, expiresAt: iso("2026-09-30T12:00:00Z") }, NOW);
    const out = await screens(
      deps({
        fetchRunSignups: async () => signups,
        setRunPlan: async (spot, date, target, setBy) => {
          saved.push({ spot, date, target, setBy });
          plan = target;
        },
        fetchRunPlan: async () => plan,
      }),
      r,
    );
    expect(saved).toEqual([{ spot: SPOT, date: RUN, target: 25, setBy: 1 }]);
    expect(out[0].text).toBe("Записала план явки: 25.");
    expect(out[1].text).toContain("План явки 25, заявок 92 % от плана");
    expect(await r.store.getForm(1)).toBeNull();
  });

  it.each(["4", "201", "abc", "25.5", "", "1e2", "-10"])("«%s» — просим ещё раз, ничего не пишем, форма открыта", async (value) => {
    const saved: unknown[] = [];
    const r = req("plan_submit", { spot: SPOT, date: RUN, value });
    await r.store.setForm(1, { kind: "run.plan", params: { spot: SPOT, date: RUN }, expiresAt: iso("2026-09-30T12:00:00Z") }, NOW);
    const [s] = await screens(deps({ setRunPlan: async () => void saved.push(1) }), r);
    expect(s.text).toBe("Нужно целое число от 5 до 200. Пришли ещё раз или /cancel");
    expect(saved).toEqual([]);
    expect(await r.store.getForm(1)).not.toBeNull();
  });

  it("прошедшему забегу план не задаётся", async () => {
    const [s] = await screens(deps(), req("plan", { spot: SPOT, date: "2026-09-26" }));
    expect(s.text).toBe("План явки задаётся только будущим забегам");
  });
});

describe("все забеги таблицей и CSV", () => {
  const rows: RunsTableRow[] = [
    { spot: "luzhniki", runDate: "2026-10-03", total: 23, confirmed: 17, reminded: 0, newPeople: 15 },
    { spot: "usachevo", runDate: "2026-09-19", total: 22, confirmed: 20, reminded: 19, newPeople: 12 },
  ];

  it("строка на забег, узкая, свежие сверху, кнопка CSV", async () => {
    const [s] = await screens(deps({ fetchRunsTable: async () => rows }), req("table", {}));
    const lines = s.text.split("\n");
    expect(lines).toContain("сб 03.10 · Лужники · заявок 23 · подтв. 17 · новых 15");
    expect(lines).toContain("сб 19.09 · Усачёва · заявок 22 · подтв. 20 · новых 12");
    expect(lines.at(-1)).toBe("Данные на 14:32 МСК");
    expect(buttonData(s)).toContain("d:run:csv");
  });

  it("длинная таблица — страницы не длиннее 4096 с «Ещё» и номером страницы в callback", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...rows[0], runDate: `2026-${String((i % 12) + 1).padStart(2, "0")}-01` }));
    const [p1] = await screens(deps({ fetchRunsTable: async () => many }), req("table", {}));
    expect(p1.text.length).toBeLessThanOrEqual(4096);
    expect(buttonData(p1)).toContain("d:run:table:2");
    const [p2] = await screens(deps({ fetchRunsTable: async () => many }), req("table", { page: "2" }));
    expect(p2.text).not.toBe(p1.text);
  });

  it("CSV: UTF-8 с BOM, «;», только агрегаты, имя «дата_что»", async () => {
    const [s] = await screens(deps({ fetchRunsTable: async () => rows }), req("csv", {}));
    expect(s.document?.filename).toBe("2026-09-30_забеги.csv");
    const csv = s.document!.content;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Дата;Точка;Заявок;Подтвердили;Напоминание ушло;Новых",
      "03.10.2026;Лужники;23;17;0;15",
      "19.09.2026;Усачёва;22;20;19;12",
      "",
    ]);
    expect(runsCsvFilename("2026-09-27")).toBe("2026-09-27_забеги.csv");
    expect(runsCsv([])).toBe("﻿Дата;Точка;Заявок;Подтвердили;Напоминание ушло;Новых\r\n");
  });
});
