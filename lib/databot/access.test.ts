import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_MATRIX,
  PEOPLE_WINDOW,
  audienceOf,
  can,
  canOpenSection,
  isEnvOwner,
  ownerIds,
  peopleWindowOpen,
  sectionOfReport,
  zoneCan,
} from "./access";
import { REPORTS, SECTIONS, type ReportId, type Section, type Subject } from "./types";

afterEach(() => vi.unstubAllEnvs());

// chat_id выдуманные: репозиторий публичный.
const ENV_OWNER = 1000001;
const OTHER_OWNER = 1000002;
const PLAIN = 2000001;

const OWNER: Subject = { chatId: OTHER_OWNER, zone: "council", isOwner: true };
const COUNCIL: Subject = { chatId: 3000001, zone: "council", isOwner: false };
const EVENTS: Subject = { chatId: 3000002, zone: "events", isOwner: false };
const SMM: Subject = { chatId: 3000003, zone: "smm", isOwner: false };

const WHO = [
  ["владелец (совет)", OWNER],
  ["совет", COUNCIL],
  ["ивенты", EVENTS],
  ["СММ", SMM],
] as const;

type Row = readonly [owner: boolean, council: boolean, events: boolean, smm: boolean];
const Y = true;
const N = false;

/** Клетки матрицы 4.1 по зоне — выписаны руками, не выведены из access.ts. */
const ZONE_EXPECT: Record<ReportId, Row> = {
  "run.section": [Y, Y, Y, Y],
  "run.card": [Y, Y, Y, Y],
  "run.past": [Y, Y, Y, Y],
  "run.table": [Y, Y, Y, Y],
  "run.table.csv": [Y, Y, Y, Y],
  "run.people": [Y, Y, Y, N],
  "run.plan.set": [Y, Y, Y, N],
  // «Соцсети» — только фаундерам (владельцам).
  "tr.section": [Y, N, N, N],
  "tr.channels": [Y, N, N, N],
  "tr.codes": [Y, N, N, N],
  "tr.code": [Y, N, N, N],
  "tr.csv": [Y, N, N, N],
  "tr.issue": [Y, N, N, N],
  "tr.ig": [Y, N, N, N],
  "tr.owner": [Y, N, N, N],
  "tr.digest": [Y, N, N, N],
  "pro.summary": [Y, Y, N, N],
  "prd.summary": [Y, Y, N, N],
  "kb.list": [Y, Y, Y, Y],
  "kb.article": [Y, Y, Y, Y],
  "kb.edit": [Y, Y, N, N],
  "tm.list": [Y, Y, N, N],
  "tm.usage": [Y, Y, N, N],
  "tm.invite": [Y, N, N, N],
  "tm.zone": [Y, N, N, N],
  "tm.remove": [Y, N, N, N],
};

/**
 * can() без контекста: fail closed там, где клетке нужен контекст для
 * персональных данных (run.people) или зон статьи (kb.article у не-совета).
 */
const CAN_NO_CTX: Record<ReportId, Row> = {
  ...ZONE_EXPECT,
  "run.people": [N, N, N, N],
  "kb.article": [Y, Y, N, N],
};

describe("матрица — каждая клетка", () => {
  for (const report of REPORTS) {
    WHO.forEach(([name, subject], i) => {
      it(`zoneCan ${report} × ${name} = ${ZONE_EXPECT[report][i]}`, () => {
        expect(zoneCan(subject, report)).toBe(ZONE_EXPECT[report][i]);
      });
      it(`can ${report} × ${name} без контекста = ${CAN_NO_CTX[report][i]}`, () => {
        expect(can(subject, report)).toBe(CAN_NO_CTX[report][i]);
      });
    });
  }
});

describe("полнота", () => {
  it("правило есть для каждого отчёта REPORTS и лишних нет", () => {
    expect(Object.keys(ACCESS_MATRIX).sort()).toEqual([...REPORTS].sort());
    expect(Object.keys(ZONE_EXPECT).sort()).toEqual([...REPORTS].sort());
  });

  it("раздел отчёта — префикс, и он из SECTIONS", () => {
    expect(sectionOfReport("run.table.csv")).toBe("run");
    expect(sectionOfReport("tm.remove")).toBe("tm");
    expect(sectionOfReport("prd.summary")).toBe("prd");
    for (const r of REPORTS) expect(SECTIONS).toContain(sectionOfReport(r));
  });
});

describe("окно списка участников", () => {
  const today = "2026-10-01";

  it("константа: 14 дней до, 3 после", () => {
    expect(PEOPLE_WINDOW).toEqual({ daysBefore: 14, daysAfter: 3 });
  });

  it.each([
    ["сегодня", "2026-10-01", true],
    ["3 дня назад", "2026-09-28", true],
    ["4 дня назад", "2026-09-27", false],
    ["через 14 дней", "2026-10-15", true],
    ["через 15 дней", "2026-10-16", false],
  ])("%s — %s", (_n, runDate, open) => {
    expect(peopleWindowOpen(runDate, today)).toBe(open);
  });

  it("через границу месяца и года", () => {
    expect(peopleWindowOpen("2027-01-14", "2026-12-31")).toBe(true);
    expect(peopleWindowOpen("2027-01-15", "2026-12-31")).toBe(false);
    expect(peopleWindowOpen("2026-12-29", "2027-01-01")).toBe(true);
    expect(peopleWindowOpen("2026-12-28", "2027-01-01")).toBe(false);
  });

  it("кривая дата — закрыто", () => {
    expect(peopleWindowOpen("2026-10-1", today)).toBe(false);
    expect(peopleWindowOpen("", today)).toBe(false);
    expect(peopleWindowOpen("2026-10-01", "завтра")).toBe(false);
  });

  it("run.people: окно одно для совета и ивентов, СММ нет даже в окне", () => {
    const inside = { runDate: "2026-10-03", today };
    const outside = { runDate: "2026-09-20", today };
    for (const s of [OWNER, COUNCIL, EVENTS]) {
      expect(can(s, "run.people", inside)).toBe(true);
      expect(can(s, "run.people", outside)).toBe(false);
    }
    expect(can(SMM, "run.people", inside)).toBe(false);
  });

  it("run.people: половины контекста мало", () => {
    expect(can(EVENTS, "run.people", { runDate: "2026-10-01" })).toBe(false);
    expect(can(EVENTS, "run.people", { today })).toBe(false);
  });
});

describe("run.plan.set — только будущие забеги", () => {
  const today = "2026-10-01";

  it("сегодня и позже — можно, вчера — нельзя", () => {
    expect(can(EVENTS, "run.plan.set", { runDate: today, today })).toBe(true);
    expect(can(EVENTS, "run.plan.set", { runDate: "2026-10-20", today })).toBe(true);
    expect(can(COUNCIL, "run.plan.set", { runDate: "2026-09-30", today })).toBe(false);
  });

  it("СММ нельзя и в будущий забег", () => {
    expect(can(SMM, "run.plan.set", { runDate: "2026-10-20", today })).toBe(false);
  });
});

describe("kb.article — по зонам статьи", () => {
  it("совет читает любую, даже без зон и чужую", () => {
    expect(can(COUNCIL, "kb.article", { articleZones: ["smm"] })).toBe(true);
    expect(can(COUNCIL, "kb.article", { articleZones: [] })).toBe(true);
  });

  it("ивенты и СММ — только статьи своей зоны", () => {
    expect(can(EVENTS, "kb.article", { articleZones: ["events"] })).toBe(true);
    expect(can(EVENTS, "kb.article", { articleZones: ["council", "smm"] })).toBe(false);
    expect(can(SMM, "kb.article", { articleZones: ["events", "smm"] })).toBe(true);
    expect(can(SMM, "kb.article", { articleZones: ["council"] })).toBe(false);
    expect(can(SMM, "kb.article", { articleZones: [] })).toBe(false);
  });
});

describe("tm.zone / tm.remove — владельца из env и себя не трогаем", () => {
  for (const report of ["tm.zone", "tm.remove"] as const) {
    it(`${report}: env-владелец → нет, сам → нет, обычный → да`, () => {
      vi.stubEnv("DATABOT_OWNER_IDS", `${ENV_OWNER},${OTHER_OWNER}`);
      expect(can(OWNER, report, { targetChatId: ENV_OWNER })).toBe(false);
      expect(can(OWNER, report, { targetChatId: OWNER.chatId })).toBe(false);
      expect(can(OWNER, report, { targetChatId: PLAIN })).toBe(true);
    });

    it(`${report}: не-владелец совета не может и над обычным`, () => {
      vi.stubEnv("DATABOT_OWNER_IDS", `${ENV_OWNER}`);
      expect(can(COUNCIL, report, { targetChatId: PLAIN })).toBe(false);
    });
  }
});

describe("ownerIds", () => {
  it("пусто — никого", () => {
    expect(ownerIds("")).toEqual(new Set());
  });

  it("trim и только целые положительные", () => {
    expect(ownerIds(" 1, 2 ,x,-3,4.5")).toEqual(new Set([1, 2]));
    expect(ownerIds("0,1e3,0x10, ,7")).toEqual(new Set([7]));
  });

  it("читает env на каждый вызов", () => {
    vi.stubEnv("DATABOT_OWNER_IDS", `${ENV_OWNER}`);
    expect(ownerIds()).toEqual(new Set([ENV_OWNER]));
    expect(isEnvOwner(ENV_OWNER)).toBe(true);
    vi.stubEnv("DATABOT_OWNER_IDS", `${PLAIN}`);
    expect(ownerIds()).toEqual(new Set([PLAIN]));
    expect(isEnvOwner(ENV_OWNER)).toBe(false);
    expect(isEnvOwner(PLAIN)).toBe(true);
  });

  it("env не задан — никого", () => {
    vi.stubEnv("DATABOT_OWNER_IDS", undefined);
    expect(ownerIds()).toEqual(new Set());
  });
});

describe("canOpenSection — все пары", () => {
  const EXPECT: Record<Section, Row> = {
    run: [Y, Y, Y, Y],
    tr: [Y, N, N, N],
    pro: [Y, Y, N, N],
    prd: [Y, Y, N, N],
    kb: [Y, Y, Y, Y],
    tm: [Y, Y, N, N],
  };
  for (const section of SECTIONS) {
    WHO.forEach(([name, subject], i) => {
      it(`${section} × ${name} = ${EXPECT[section][i]}`, () => {
        expect(canOpenSection(subject, section)).toBe(EXPECT[section][i]);
      });
    });
  }
});

describe("audienceOf", () => {
  it("для текста отказа", () => {
    expect(audienceOf("pro.summary")).toEqual(["council"]);
    expect(audienceOf("run.people")).toEqual(["council", "events"]);
    expect(audienceOf("tm.invite")).toBe("owner");
    expect(audienceOf("run.card")).toEqual(["council", "events", "smm"]);
  });
});
