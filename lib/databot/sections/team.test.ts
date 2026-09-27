import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { callbackBytes } from "../callback";
import { MemoryStore } from "../data/memory-store";
import type { SectionOutcome, SectionRequest } from "../section";
import type { AnyReport, Intent, MemberRow, Screen, Zone } from "../types";
import { handleTeam } from "./team";

/**
 * «Команда» на MemoryStore и фейковых effects. chat_id и имена выдуманные:
 * репозиторий публичный. Владельцы задаются через env, как в бою, — матрицу
 * доступа (access.ts) не мокаем.
 */

const OWNER = 800001; // владелец из env, смотрит список
const OWNER2 = 800006; // второй владелец из env
const COUNCIL = 800002; // совет, не владелец
const EVENTS = 800003;
const SMM_NICK = 800004; // без имени, только ник
const SMM_NONE = 800005; // ни имени, ни ника

const NOW = new Date("2026-09-27T11:32:00Z"); // 14:32 МСК
const DAY = 24 * 60 * 60 * 1000;

function row(chat_id: number, zone: Zone, patch: Partial<MemberRow> = {}): MemberRow {
  return {
    chat_id,
    username: null,
    display_name: null,
    zone,
    is_owner: false,
    invited_by: OWNER,
    joined_at: "2026-09-01T09:00:00Z",
    last_seen_at: null,
    is_active: true,
    removed_at: null,
    ...patch,
  };
}

let store: MemoryStore;
let commands: Array<[number, Zone | null]>;

function seed(): void {
  const members = [
    row(SMM_NONE, "smm"),
    row(EVENTS, "events", { display_name: "Ева Тестова", username: "eva_test", last_seen_at: "2026-09-26T07:05:00Z" }),
    row(COUNCIL, "council", { display_name: "Борис Тестов", username: "boris_test" }),
    row(SMM_NICK, "smm", { username: "smm_nick" }),
    row(OWNER2, "council", { display_name: "Второй Владелец", is_owner: true }),
    row(OWNER, "council", { display_name: "Аня Владелица", is_owner: true, last_seen_at: NOW.toISOString() }),
  ];
  for (const m of members) store.members.set(m.chat_id, m);
}

function audit(chat_id: number, report: AnyReport, ageMs: number): void {
  store.audit.push({
    chat_id,
    zone: null,
    report,
    params: {},
    source: "button",
    ok: true,
    created_at: new Date(NOW.getTime() - ageMs).toISOString(),
  });
}

function intent(action: string, params: Record<string, string> = {}, report: Intent["report"] = "tm.list"): Intent {
  return { report, section: "tm", action, params, source: "button" };
}

function req(chatId: number, i: Intent): SectionRequest {
  const member = store.members.get(chatId)!;
  return {
    subject: { chatId, zone: member.zone, isOwner: chatId === OWNER || chatId === OWNER2 },
    member,
    intent: i,
    store,
    effects: {
      setCommands: async (id, zone) => {
        commands.push([id, zone]);
      },
    },
    now: NOW,
    botUsername: "test_databot",
  };
}

function screensOf(out: SectionOutcome): Screen[] {
  if (out.kind !== "screens") throw new Error(`ожидались экраны, пришло ${out.kind}`);
  return out.screens;
}

function allData(s: Screen): string[] {
  return (s.buttons ?? []).flat().map((b) => b.data);
}

function allTexts(s: Screen): string[] {
  return (s.buttons ?? []).flat().map((b) => b.text);
}

beforeEach(() => {
  vi.stubEnv("DATABOT_OWNER_IDS", `${OWNER},${OWNER2}`);
  store = new MemoryStore();
  commands = [];
  seed();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("список", () => {
  it("владельцы, потом совет, ивенты, СММ; визиты и запросы за 7 дней", async () => {
    audit(EVENTS, "run.card", 1 * DAY);
    audit(EVENTS, "menu", 2 * DAY); // служебные в «запросах» тоже считаются
    audit(EVENTS, "run.card", 8 * DAY); // старше недели — не считается
    audit(COUNCIL, "pro.summary", 6 * DAY);
    const [s] = screensOf(await handleTeam(req(OWNER, intent("list"))));
    const blocks = s.text.split("\n\n");

    const order = ["Аня Владелица", "Второй Владелец", "Борис Тестов", "Ева Тестова", "@smm_nick", "без имени"];
    const positions = order.map((name) => s.text.indexOf(`<b>${name}</b>`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const eva = blocks.find((b) => b.includes("Ева Тестова"))!;
    expect(eva).toContain("@eva_test");
    expect(eva).toContain("Ивенты");
    expect(eva).toContain("визит 26.09 10:05"); // МСК
    expect(eva).toContain("запросов за 7 дней: 2");

    const boris = blocks.find((b) => b.includes("Борис Тестов"))!;
    expect(boris).toContain("визитов не было");
    expect(boris).toContain("запросов за 7 дней: 1");
    expect(boris).not.toContain("владелец");

    const anya = blocks.find((b) => b.includes("Аня Владелица"))!;
    expect(anya).toContain("владелец");
    expect(anya).toContain("визит 27.09 14:32");

    // Ник не дублируем, если имя и есть ник.
    const nick = blocks.find((b) => b.includes("@smm_nick"))!;
    expect(nick.match(/@smm_nick/g)).toHaveLength(1);

    expect(s.text).toContain("Данные на 14:32 МСК");
    expect(s.protect).toBe(true);
  });

  it("совет без владельца: только «Кто пользуется» и «Назад»", async () => {
    const [s] = screensOf(await handleTeam(req(COUNCIL, intent("list"))));
    expect(allData(s)).toEqual(["d:tm:usage", "d:tm:home"]);
  });

  it("владелец: «Пригласить» и ряды управления, но не напротив владельцев из env и себя", async () => {
    const [s] = screensOf(await handleTeam(req(OWNER, intent("list"))));
    const data = allData(s);
    expect(data).toContain("d:tm:inv");
    for (const id of [COUNCIL, EVENTS, SMM_NICK, SMM_NONE]) {
      expect(data).toContain(`d:tm:zone:${id}`);
      expect(data).toContain(`d:tm:rm:${id}`);
    }
    for (const id of [OWNER, OWNER2]) {
      expect(data).not.toContain(`d:tm:zone:${id}`);
      expect(data).not.toContain(`d:tm:rm:${id}`);
    }
    expect(allTexts(s)).toContain("Убрать: Борис Тестов");
    expect(data[data.length - 1]).toBe("d:tm:home");
  });

  it("длинное имя в кнопке обрезано, в тексте — целиком", async () => {
    const long = "Очень Длинное Имя Участника Команды";
    store.members.get(EVENTS)!.display_name = long;
    const [s] = screensOf(await handleTeam(req(OWNER, intent("list"))));
    expect(s.text).toContain(long);
    const btn = allTexts(s).find((t) => t.startsWith("Убрать: Очень"))!;
    expect(btn.endsWith("…")).toBe(true);
    expect(btn.length).toBeLessThan(`Убрать: ${long}`.length);
  });

  it("имя с HTML экранируется", async () => {
    store.members.get(EVENTS)!.display_name = "<b>&";
    const [s] = screensOf(await handleTeam(req(OWNER, intent("list"))));
    expect(s.text).toContain("<b>&lt;b&gt;&amp;</b>");
    expect(s.text).not.toContain("<b><b>&");
  });
});

describe("кто пользуется", () => {
  it("люди по убыванию, топ-5 отчётов без служебных", async () => {
    for (let i = 0; i < 4; i++) audit(EVENTS, "run.card", DAY);
    for (let i = 0; i < 3; i++) audit(SMM_NICK, "tr.channels", DAY);
    audit(COUNCIL, "pro.summary", DAY);
    audit(COUNCIL, "kb.list", DAY);
    audit(COUNCIL, "tr.issue", DAY);
    audit(COUNCIL, "prd.summary", DAY);
    for (let i = 0; i < 9; i++) audit(COUNCIL, "menu", DAY);
    audit(OWNER, "run.card", 10 * DAY); // старое

    const [s] = screensOf(await handleTeam(req(COUNCIL, intent("usage", {}, "tm.usage"))));
    const lines = s.text.split("\n");
    const people = lines.filter((l) => / — \d+$/.test(l)).slice(0, 6);
    expect(people[0]).toBe("Борис Тестов — 13");
    expect(people[1]).toBe("Ева Тестова — 4");
    expect(people[2]).toBe("@smm_nick — 3");

    const top = lines.slice(lines.indexOf("Чаще всего:") + 1, -1);
    expect(top).toHaveLength(5);
    expect(top[0]).toBe("Карточка забега — 4");
    expect(top[1]).toBe("Переходы по каналам — 3");
    expect(s.text).not.toMatch(/menu/);
    expect(allData(s)).toEqual(["d:tm:list"]);
  });
});

describe("приглашение", () => {
  it("без зоны — выбор зоны", async () => {
    const [s] = screensOf(await handleTeam(req(OWNER, intent("invite", {}, "tm.invite"))));
    expect(s.text).toContain("Кого зовём");
    expect(allData(s)).toEqual(["d:tm:inv:council", "d:tm:inv:events", "d:tm:inv:smm", "d:tm:list"]);
  });

  it("с зоной — приглашение в базе на 48 часов, ссылка и текст для пересылки", async () => {
    const out = screensOf(await handleTeam(req(OWNER, intent("invite", { zone: "smm" }, "tm.invite"))));
    expect(out).toHaveLength(2);
    const [invite] = [...store.invites.values()];
    expect(invite).toMatchObject({ zone: "smm", created_by: OWNER, used_at: null });
    expect(Date.parse(invite.expires_at) - NOW.getTime()).toBe(48 * 60 * 60 * 1000);

    const link = `https://t.me/test_databot?start=inv_${invite.token}`;
    expect(invite.token).toMatch(/^[0-9a-f]{32}$/);
    expect(out[0].text).toContain(link);
    expect(out[0].text).toContain("СММ");
    expect(allData(out[0])).toEqual(["d:tm:list"]);
    expect(out[1].text).toContain(link);
    expect(out[1].text).toContain("одноразовая, работает 48 часов");
    expect(out[1].buttons).toBeUndefined();
  });
});

describe("смена зоны", () => {
  it("без зоны — выбор с отметкой текущей", async () => {
    const [s] = screensOf(await handleTeam(req(OWNER, intent("zone", { target: String(EVENTS) }, "tm.zone"))));
    expect(allTexts(s)).toContain("✓ Ивенты");
    expect(allData(s)).toEqual([
      `d:tm:zone:${EVENTS}:council`,
      `d:tm:zone:${EVENTS}:events`,
      `d:tm:zone:${EVENTS}:smm`,
      "d:tm:list",
    ]);
  });

  it("с зоной — setZone, меню команд и свежий список", async () => {
    const out = screensOf(
      await handleTeam(req(OWNER, intent("zone", { target: String(EVENTS), zone: "smm" }, "tm.zone"))),
    );
    expect(store.members.get(EVENTS)!.zone).toBe("smm");
    expect(commands).toEqual([[EVENTS, "smm"]]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("Готово: <b>Ева Тестова</b> теперь в зоне СММ");
    const eva = out[0].text.split("\n\n").find((b) => b.startsWith("<b>Ева Тестова</b>"))!;
    expect(eva).toContain("СММ");
  });

  it("человек уже убран — экран устарел", async () => {
    store.members.get(EVENTS)!.is_active = false;
    expect(await handleTeam(req(OWNER, intent("zone", { target: String(EVENTS) }, "tm.zone")))).toEqual({
      kind: "stale",
    });
    expect(
      await handleTeam(req(OWNER, intent("zone", { target: String(EVENTS), zone: "smm" }, "tm.zone"))),
    ).toEqual({ kind: "stale" });
    expect(commands).toEqual([]);
  });
});

describe("убрать", () => {
  it("без ok — подтверждение", async () => {
    const [s] = screensOf(await handleTeam(req(OWNER, intent("remove", { target: String(EVENTS) }, "tm.remove"))));
    expect(s.text).toBe("Убрать <b>Ева Тестова</b>? Доступ пропадёт сразу.");
    expect(allData(s)).toEqual([`d:tm:rm:${EVENTS}:ok`, "d:tm:list"]);
    expect(store.members.get(EVENTS)!.is_active).toBe(true);
  });

  it("с ok — неактивен, форма стёрта, меню снято, список без человека", async () => {
    store.sessions.set(`data:${EVENTS}`, { form: "run.plan.set" });
    store.sessions.set(`data:${COUNCIL}`, { form: "kb.edit" });
    const out = screensOf(
      await handleTeam(req(OWNER, intent("remove", { target: String(EVENTS), confirm: "ok" }, "tm.remove"))),
    );
    const m = store.members.get(EVENTS)!;
    expect(m.is_active).toBe(false);
    expect(m.removed_at).toBe(NOW.toISOString());
    expect(store.sessions.has(`data:${EVENTS}`)).toBe(false);
    expect(store.sessions.has(`data:${COUNCIL}`)).toBe(true);
    expect(commands).toEqual([[EVENTS, null]]);
    expect(out[0].text.startsWith("Убрала <b>Ева Тестова</b>.")).toBe(true);
    expect(out[0].text.split("\n\n").some((b) => b.startsWith("<b>Ева Тестова</b>"))).toBe(false);
    expect(allData(out[0])).not.toContain(`d:tm:rm:${EVENTS}`);
  });

  it("цель уже убрана — экран устарел", async () => {
    await store.removeMember(EVENTS, NOW);
    const variants: Record<string, string>[] = [{ target: String(EVENTS) }, { target: String(EVENTS), confirm: "ok" }];
    for (const params of variants) {
      expect(await handleTeam(req(OWNER, intent("remove", params, "tm.remove")))).toEqual({ kind: "stale" });
    }
    expect(commands).toEqual([]);
  });

  it("владельца из env и себя не трогает даже в обход конвейера", async () => {
    for (const target of [OWNER, OWNER2]) {
      expect(
        await handleTeam(req(OWNER, intent("remove", { target: String(target), confirm: "ok" }, "tm.remove"))),
      ).toEqual({ kind: "stale" });
      expect(store.members.get(target)!.is_active).toBe(true);
    }
  });
});

it("неизвестное действие — экран устарел", async () => {
  expect(await handleTeam(req(OWNER, intent("nope")))).toEqual({ kind: "stale" });
});

it("все callback_data — d:tm:… и не длиннее 64 байт", async () => {
  // Самый длинный реальный chat_id — 13+ цифр у пользователей; проверяем с запасом.
  const big = 9_999_999_999_999;
  store.members.set(big, row(big, "events", { display_name: "Длинный Айди" }));
  const outs = [
    await handleTeam(req(OWNER, intent("list"))),
    await handleTeam(req(OWNER, intent("usage", {}, "tm.usage"))),
    await handleTeam(req(OWNER, intent("invite", {}, "tm.invite"))),
    await handleTeam(req(OWNER, intent("invite", { zone: "events" }, "tm.invite"))),
    await handleTeam(req(OWNER, intent("zone", { target: String(big) }, "tm.zone"))),
    await handleTeam(req(OWNER, intent("remove", { target: String(big) }, "tm.remove"))),
    await handleTeam(req(OWNER, intent("zone", { target: String(big), zone: "council" }, "tm.zone"))),
  ];
  const data = outs.flatMap((o) => screensOf(o).flatMap(allData));
  expect(data.length).toBeGreaterThan(10);
  for (const d of data) {
    expect(d.startsWith("d:tm:")).toBe(true);
    expect(callbackBytes(d)).toBeLessThanOrEqual(64);
  }
});
