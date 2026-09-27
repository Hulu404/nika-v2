import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveRow } from "../../team/history";
import type { SignupRow } from "../../team/stats";
import { MemoryStore } from "../data/memory-store";
import type { RunPeople } from "../data/runs";
import { needsTopUp } from "../copy";
import type { SectionRequest } from "../section";
import type { Intent, MemberRow, Screen, Subject } from "../types";
import { createRunsHandler, dynamicsSummary, reminderWindowOpen, type RunsDeps } from "./runs";

/**
 * Раздел «Забеги» на выдуманных данных. Заявки, статусы и динамика
 * проходят через настоящие функции lib/team — подменено только чтение.
 */

const SPOT = "luzhniki";
const RUN = "2026-10-03"; // суббота
// За 3 дня до старта, 14:32 МСК.
const NOW = new Date("2026-09-30T11:32:00Z");

const iso = (s: string) => new Date(s).toISOString();

/** Заявка на забег: created_at, подтверждение, темп. */
function signup(runDate: string, createdAt: string, opts: Partial<SignupRow> = {}): SignupRow & ArchiveRow {
  return {
    spot: SPOT,
    run_date: runDate,
    name: "Участник",
    contact: "@nick",
    pace: null,
    created_at: iso(createdAt),
    confirmed_at: null,
    reminder_sent_at: null,
    tg_username: null,
    tg_chat_id: null,
    ...opts,
  };
}

/**
 * Пример из ТЗ 4.10: 23 заявки, 17 подтвердили, за сутки +4; темп 5/9/6/3;
 * два прошлых забега в Лужниках, за 3 дня до старта у них было 12 и 16, в
 * итоге 20 и 21.
 */
function exampleData() {
  const current: Array<SignupRow & ArchiveRow> = [];
  const paces: Array<string | null> = [
    ...Array(5).fill("6:30"),
    ...Array(9).fill("7:00"),
    ...Array(6).fill("8:00"),
    ...Array(3).fill(null),
  ];
  paces.forEach((pace, i) => {
    // 19 заявок раньше суток назад, 4 — за последние сутки.
    const createdAt = i < 19 ? "2026-09-25T10:00:00Z" : "2026-09-30T08:00:00Z";
    const confirmed = i < 17;
    current.push(
      signup(RUN, createdAt, {
        pace,
        confirmed_at: confirmed ? iso("2026-09-29T10:00:00Z") : null,
        tg_chat_id: confirmed ? 1000 + i : null,
      }),
    );
  });

  // Прошлые забеги: к «за 3 дня до старта» было 12 и 16, в итоге 20 и 21.
  const previous: ArchiveRow[] = [];
  const addPast = (date: string, early: number, total: number, earlyAt: string, lateAt: string) => {
    for (let i = 0; i < total; i++) previous.push(signup(date, i < early ? earlyAt : lateAt));
  };
  addPast("2026-09-26", 16, 21, "2026-09-20T10:00:00Z", "2026-09-25T10:00:00Z");
  addPast("2026-09-12", 12, 20, "2026-09-06T10:00:00Z", "2026-09-11T10:00:00Z");

  return { current, archive: [...current, ...previous] };
}

function deps(over: Partial<RunsDeps> & { archive: ArchiveRow[]; signups?: SignupRow[] }): RunsDeps {
  return {
    fetchArchive: async () => over.archive,
    fetchRunSignups: over.fetchRunSignups ?? (async () => over.signups ?? []),
    fetchRunPeople:
      over.fetchRunPeople ??
      (async (): Promise<RunPeople> => ({ total: 0, newPeople: 0, returningPeople: 0, byLink: {} })),
    fetchRunPlan: over.fetchRunPlan ?? (async () => null),
    fetchRunRoster: over.fetchRunRoster ?? (async () => []),
    setRunPlan: over.setRunPlan ?? (async () => {}),
    fetchRunsTable: over.fetchRunsTable ?? (async () => []),
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

function req(action: string, params: Record<string, string>, zone: Subject["zone"] = "events", now = NOW): SectionRequest {
  const intent: Intent = { report: "run.card", section: "run", action, params, source: "button" };
  return {
    subject: { chatId: 1, zone, isOwner: false },
    member: { ...member, zone },
    intent,
    store: new MemoryStore(),
    effects: { setCommands: async () => {} },
    now,
    botUsername: "test_databot",
  };
}

async function screen(handler: ReturnType<typeof createRunsHandler>, r: SectionRequest): Promise<Screen> {
  const out = await handler(r);
  if (out.kind !== "screens") throw new Error("ждали экран, а не stale");
  return out.screens[0];
}

const buttonData = (s: Screen) => (s.buttons ?? []).flat().map((b) => b.data);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("карточка — пример из ТЗ 4.10", () => {
  it("воспроизводится на выдуманных данных через функции lib/team", async () => {
    const { current, archive } = exampleData();
    const handler = createRunsHandler(
      deps({
        archive,
        signups: current,
        fetchRunPeople: async () => ({
          total: 23,
          newPeople: 15,
          returningPeople: 8,
          byLink: { "CRLUZH-0310": 9, "IGST-0110": 6, none: 8 },
        }),
        fetchRunPlan: async () => 25,
      }),
    );
    const lines = (await screen(handler, req("card", { spot: SPOT, date: RUN }))).text.split("\n");

    expect(lines).toEqual([
      "Кофе-ран · Surf Coffee® Лужники · сб 03.10",
      "Заявок 23, подтвердили в боте 17, за сутки +4",
      "Новых среди заявок 15, записывались раньше 8",
      "Темп: 6:30 — 5, 7:00 — 9, 8:00 — 6, без темпа — 3",
      "По меткам: CRLUZH-0310 — 9, IGST-0110 — 6, без метки — 8",
      "План явки 25, заявок 92 % от плана",
      // Отличие от примера 4.10 — сознательное: динамика формулировками
      // lib/team/copy.ts (Промт 5), прогноз — полным текстом из 4.4.
      "За 3 дня до старта: сейчас 23, на 9 больше, чем обычно (к этому моменту — 14)",
      "Прогноз итога: 30–38 заявок (по двум прошлым забегам в Лужниках за столько же дней до старта)",
      "Данные на 14:32 МСК",
    ]);
  });

  it("новые плюс повторные совпадают с числом заявок lib/team", async () => {
    const { current, archive } = exampleData();
    const warn = vi.spyOn(console, "warn");
    const handler = createRunsHandler(
      deps({
        archive,
        signups: current,
        fetchRunPeople: async () => ({ total: 22, newPeople: 14, returningPeople: 8, byLink: {} }),
      }),
    );
    await screen(handler, req("card", { spot: SPOT, date: RUN }));
    // Расхождение не прячется: карточка строится, но в лог уходит предупреждение.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("22 ≠ lib/team 23"));
  });
});

describe("карточка — строки и кнопки", () => {
  it("добор — за 1–3 дня до старта и ниже 60 % плана", () => {
    expect(needsTopUp({ total: 10, plan: 25, daysBefore: 3 })).toBe(true);
    expect(needsTopUp({ total: 10, plan: 25, daysBefore: 1 })).toBe(true);
    expect(needsTopUp({ total: 10, plan: 25, daysBefore: 4 })).toBe(false);
    expect(needsTopUp({ total: 10, plan: 25, daysBefore: 0 })).toBe(false);
    expect(needsTopUp({ total: 15, plan: 25, daysBefore: 2 })).toBe(false); // ровно 60 %
    expect(needsTopUp({ total: 10, plan: null, daysBefore: 2 })).toBe(false);
  });

  it("строка добора и «План явки не задан» в карточке", async () => {
    const { current, archive } = exampleData();
    const low = createRunsHandler(deps({ archive, signups: current, fetchRunPlan: async () => 60 }));
    const lowText = (await screen(low, req("card", { spot: SPOT, date: RUN }))).text;
    expect(lowText).toContain("План явки 60, заявок 38 % от плана\nНиже 60 % плана: по регламенту включаем добор");

    const none = createRunsHandler(deps({ archive, signups: current }));
    expect((await screen(none, req("card", { spot: SPOT, date: RUN }))).text).toContain("План явки не задан");
  });

  it("строки меток нет, пока нет ни одной заявки с меткой", async () => {
    const { current, archive } = exampleData();
    const handler = createRunsHandler(
      deps({ archive, signups: current, fetchRunPeople: async () => ({ total: 23, newPeople: 23, returningPeople: 0, byLink: { none: 23 } }) }),
    );
    expect((await screen(handler, req("card", { spot: SPOT, date: RUN }))).text).not.toContain("По меткам");
  });

  it("список участников и план явки — ивентам да, СММ нет", async () => {
    const { current, archive } = exampleData();
    const handler = createRunsHandler(deps({ archive, signups: current }));
    const events = buttonData(await screen(handler, req("card", { spot: SPOT, date: RUN }, "events")));
    expect(events).toContain(`d:run:people:${SPOT}:${RUN}:1`);
    expect(events).toContain(`d:run:plan:${SPOT}:${RUN}`);
    const smm = buttonData(await screen(handler, req("card", { spot: SPOT, date: RUN }, "smm")));
    expect(smm.some((d) => d.startsWith("d:run:people"))).toBe(false);
    expect(smm.some((d) => d.startsWith("d:run:plan"))).toBe(false);
    expect(smm).toContain(`d:run:spot:${SPOT}`);
  });

  it("список участников закрыт вне окна −3…+14 дней", async () => {
    const { current, archive } = exampleData();
    const handler = createRunsHandler(deps({ archive, signups: current }));
    const farAhead = new Date("2026-09-15T09:00:00Z"); // за 18 дней
    const data = buttonData(await screen(handler, req("card", { spot: SPOT, date: RUN }, "council", farAhead)));
    expect(data.some((d) => d.startsWith("d:run:people"))).toBe(false);
  });

  it("напоминания — только после окна рассылки (накануне с 10:00 МСК)", () => {
    expect(reminderWindowOpen(RUN, new Date("2026-10-02T06:59:00Z"))).toBe(false); // 09:59 МСК накануне
    expect(reminderWindowOpen(RUN, new Date("2026-10-02T07:00:00Z"))).toBe(true);
    expect(reminderWindowOpen(RUN, new Date("2026-10-03T05:00:00Z"))).toBe(true);
  });

  it("прошедший забег вне расписания: без сбора и адреса, итог и строка про явку", async () => {
    const { archive } = exampleData();
    const past = archive.filter((r) => r.run_date === "2026-09-26") as Array<SignupRow & ArchiveRow>;
    const handler = createRunsHandler(deps({ archive, signups: past }));
    const lines = (await screen(handler, req("card", { spot: SPOT, date: "2026-09-26" }))).text.split("\n");
    expect(lines[0]).toBe("Кофе-ран · Surf Coffee® Лужники · сб 26.09");
    expect(lines[1]).toMatch(/^Итог: заявок 21, подтвердили в боте 0, напоминание ушло 0$/);
    expect(lines).toContain("Явку база не знает: сколько людей дошло, смотрим в строке цифр ведущей");
    expect(lines.join("\n")).not.toMatch(/Сбор|Прогноз|План явки не задан/);
  });

  it("забег из расписания с нулём заявок — честные нули, со сбором и адресом", async () => {
    // 20.09 Лужники есть в COFFEE_RUNS; «сейчас» — до него.
    const handler = createRunsHandler(deps({ archive: [] }));
    const lines = (
      await screen(handler, req("card", { spot: SPOT, date: "2026-09-20" }, "events", new Date("2026-09-15T09:00:00Z")))
    ).text.split("\n");
    expect(lines[1]).toMatch(/^Сбор 9:30, старт 10:00 · /);
    expect(lines[2]).toBe("Заявок пока нет");
    expect(lines).toContain("Прогноза нет: не с чем сравнить — раньше на этой точке к этому дню запись не шла");
  });

  it("забега нет ни в расписании, ни в базе — экран устарел", async () => {
    const handler = createRunsHandler(deps({ archive: [] }));
    await expect(handler(req("card", { spot: SPOT, date: "2027-01-01" }))).resolves.toEqual({ kind: "stale" });
  });
});

describe("экран раздела и поиск забега", () => {
  const twoOnDate = (): ArchiveRow[] => [
    signup("2026-10-10", "2026-09-28T10:00:00Z"),
    { ...signup("2026-10-10", "2026-09-28T10:00:00Z"), spot: "usachevo" },
    signup("2026-10-17", "2026-09-28T10:00:00Z"),
    signup("2026-10-24", "2026-09-28T10:00:00Z"),
    signup("2026-10-31", "2026-09-28T10:00:00Z"),
    signup("2026-11-07", "2026-09-28T10:00:00Z"),
  ];

  it("до четырёх ближайших от ранних к поздним, «Прошедшие», «Все забеги таблицей»", async () => {
    const s = await screen(createRunsHandler(deps({ archive: twoOnDate() })), req("list", {}));
    const data = buttonData(s);
    const cards = data.filter((d) => d.startsWith("d:run:card"));
    expect(cards).toEqual([
      "d:run:card:luzhniki:2026-10-10",
      "d:run:card:usachevo:2026-10-10",
      "d:run:card:luzhniki:2026-10-17",
      "d:run:card:luzhniki:2026-10-24",
    ]);
    expect(data).toContain("d:run:past");
    expect(data).toContain("d:run:table");
  });

  it("на дату два забега — «Уточни:» и кнопки спотов", async () => {
    const s = await screen(createRunsHandler(deps({ archive: twoOnDate() })), req("list", { q: "10.10" }));
    expect(s.text).toBe("Уточни:");
    expect(buttonData(s).filter((d) => d.startsWith("d:run:card"))).toEqual([
      "d:run:card:luzhniki:2026-10-10",
      "d:run:card:usachevo:2026-10-10",
    ]);
  });

  it("на дату нет забега — «На 04.10 забегов нет. Ближайшие:» и кнопки", async () => {
    const s = await screen(createRunsHandler(deps({ archive: twoOnDate() })), req("list", { q: "04.10" }));
    expect(s.text).toBe("На 04.10 забегов нет. Ближайшие:");
    expect(buttonData(s).filter((d) => d.startsWith("d:run:card")).length).toBe(4);
  });

  it("ближайших нет — так и пишем", async () => {
    const s = await screen(createRunsHandler(deps({ archive: [] })), req("list", {}));
    expect(s.text).toContain("Ближайших забегов в расписании нет");
  });
});

describe("строка динамики", () => {
  it("одно наблюдение — «в прошлый сравнимый раз», а не «обычно»", () => {
    const line = dynamicsSummary({
      daysBefore: 3,
      now: 10,
      previous: [{ date: "2026-09-26", atSameLead: 6, final: 20, opened: true }],
      typical: 6,
      comparable: 1,
    });
    expect(line).toBe("За 3 дня до старта: сейчас 10, на 4 больше, чем в прошлый сравнимый раз (тогда — 6)");
  });

  it("сравнивать не с чем — честно", () => {
    const line = dynamicsSummary({
      daysBefore: 5,
      now: 3,
      previous: [{ date: "2026-09-26", atSameLead: 0, final: 20, opened: false }],
      typical: null,
      comparable: 0,
    });
    expect(line).toBe("За 5 дней до старта: сейчас 3, сравнить не с чем: раньше к этому дню запись ещё не открывали");
  });
});
