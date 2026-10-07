import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignedTask } from "../../databot/task-list";
import type { TeamMember } from "../access";
import { currentSlot, dispatchFounderDigest, founderDigestText, relativeDue, socialText, type FounderDigestDeps } from "./digest";
import { MemorySocialStore } from "./social-store";

const msk = (local: string) => new Date(`${local}+03:00`);
const iso = (local: string) => msk(local).toISOString();

const task = (patch: Partial<AssignedTask>): AssignedTask => ({
  id: 1, line: 1, username: "vika", what: "Разбор воронки", due_at: null, source_chat_id: 1, source_message_id: 1,
  assignee_id: 11, assigned_by: 12, created_at: iso("2026-10-01T10:00"), delivery_state: "sent", delivered_message_id: 1,
  status: "open", status_at: iso("2026-10-01T10:00"), reminded_at: null, overdue_notified_at: null, ...patch,
});
const member = (chat_id: number, username: string, last_seen_at: string | null): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: iso("2026-09-01T10:00"), added_by: null,
  last_seen_at, digest_opt_in: true,
});

describe("окно сводки", () => {
  it("10:00 охватывает 22:30 прошлого дня – 10:00, 22:30 — 10:00 – 22:30", () => {
    expect(currentSlot(msk("2026-10-07T10:00"))).toEqual({ key: "10:00", ymd: "2026-10-07", at: msk("2026-10-07T10:00"), from: msk("2026-10-06T22:30") });
    expect(currentSlot(msk("2026-10-07T22:45"))).toEqual({ key: "22:30", ymd: "2026-10-07", at: msk("2026-10-07T22:30"), from: msk("2026-10-07T10:00") });
  });

  it("переход через полночь: в 00:40 текущий слот — вчерашние 22:30, в 09:59 тоже", () => {
    expect(currentSlot(msk("2026-10-08T00:40"))).toMatchObject({ key: "22:30", ymd: "2026-10-07" });
    expect(currentSlot(msk("2026-10-08T09:59"))).toMatchObject({ key: "22:30", ymd: "2026-10-07" });
    expect(currentSlot(msk("2026-10-08T10:00"))).toMatchObject({ key: "10:00", ymd: "2026-10-08", from: msk("2026-10-07T22:30") });
  });
});

describe("текст сводки", () => {
  const slot = currentSlot(msk("2026-10-07T22:30"));
  const now = msk("2026-10-07T22:30");
  const team = [
    member(11, "vika", iso("2026-10-07T12:00")),
    member(12, "ali", iso("2026-10-07T09:00")), // до окна
    member(13, "danya", iso("2026-10-02T12:00")), // 5 дн.
    member(14, "nastya", null),
    member(9, "founder", iso("2026-10-07T15:00")),
  ];

  it("задачи окна, просрочка сейчас, команда без фаундеров, соцсети", () => {
    const tasks = [
      task({ id: 1, status: "done", status_at: iso("2026-10-07T15:00") }),
      task({ id: 2, status: "done", status_at: iso("2026-10-07T09:00"), what: "Вчерашнее" }), // вне окна
      task({ id: 3, status: "declined", status_at: iso("2026-10-07T18:00"), username: "danya", what: "Пост про Усачёву" }),
      task({ id: 4, status: "taken", username: "danya", what: "Пост про Усачёву", due_at: iso("2026-10-06T18:00") }),
    ];
    const text = founderDigestText({ slot, now, tasks, team, founders: [9], social: [] });
    expect(text).toContain("Сводка 22:30 · 7 октября");
    expect(text).toContain("✅ Выполнено: 1\n  · @vika · Разбор воронки (от @ali)");
    expect(text).not.toContain("Вчерашнее");
    expect(text).toContain("↩️ Отказались: 1\n  · @danya · Пост про Усачёву");
    expect(text).toContain("⏰ Просрочено сейчас: 1\n  · @danya · Пост про Усачёву · срок вчера 18:00");
    expect(text).toContain("Заходили: @vika");
    expect(text).toContain("Давно не было (3+ дня): @danya · 5 дн., @nastya · ни разу");
    expect(text).not.toContain("@founder");
  });

  it("пустые блоки не прячет, длинные списки режет до 10 строк", () => {
    const empty = founderDigestText({ slot, now, tasks: [], team: [member(9, "founder", null)], founders: [9], social: [] });
    expect(empty).toContain("✅ Выполнено: 0\n↩️ Отказались: 0\n⏰ Просрочено сейчас: 0");
    expect(empty).toContain("Заходили: никто");
    expect(empty).toContain("Давно не было (3+ дня): нет");
    const many = Array.from({ length: 14 }, (_, i) => task({ id: i + 1, status: "done", status_at: iso("2026-10-07T15:00"), what: `Дело ${i + 1}` }));
    const text = founderDigestText({ slot, now, tasks: many, team, founders: [9], social: [] });
    expect(text).toContain("✅ Выполнено: 14");
    expect(text).toContain("Дело 10");
    expect(text).not.toContain("Дело 11");
    expect(text).toContain("  · и ещё 4");
  });

  it("срок «вчера», «сегодня», дата; конец дня без времени", () => {
    expect(relativeDue(iso("2026-10-06T18:00"), now)).toBe("вчера 18:00");
    expect(relativeDue(iso("2026-10-07T12:00"), now)).toBe("сегодня 12:00");
    expect(relativeDue(iso("2026-10-03T23:59"), now)).toBe("03.10");
  });
});

describe("соцсети в сводке", () => {
  const now = msk("2026-10-07T22:30");
  const snap = (platform: "telegram" | "instagram", followers: number, at: string) =>
    ({ platform, followers, source: "manual" as const, taken_at: iso(at), entered_by: 1 });

  it("прирост за сутки и неделю; без старых снимков — «нет данных», а не +0", () => {
    expect(socialText({ platform: "telegram", latest: snap("telegram", 1240, "2026-10-07T22:30"),
      dayAgo: snap("telegram", 1228, "2026-10-06T21:00"), weekAgo: snap("telegram", 1192, "2026-09-30T21:00") }, now))
      .toBe("TG-канал: 1 240 (+12 за сутки, +48 за неделю)");
    expect(socialText({ platform: "telegram", latest: snap("telegram", 1240, "2026-10-07T22:30"),
      dayAgo: snap("telegram", 1245, "2026-10-06T21:00"), weekAgo: null }, now))
      .toBe("TG-канал: 1 240 (-5 за сутки, нет данных за неделю)");
  });

  it("Instagram без снимка за сегодня — «не внесено сегодня» с последним числом", () => {
    expect(socialText({ platform: "instagram", latest: snap("instagram", 3870, "2026-10-05T21:10"), dayAgo: null, weekAgo: null }, now))
      .toBe("Instagram: не внесено сегодня (последнее 3 870, 05.10)");
    expect(socialText({ platform: "instagram", latest: null, dayAgo: null, weekAgo: null }, now)).toBe("Instagram: ещё ни разу не вносили");
  });

  it("Telegram не ответил — «не удалось получить»", () => {
    expect(socialText({ platform: "telegram", latest: null, dayAgo: null, weekAgo: null, failed: true }, now)).toBe("TG-канал: не удалось получить");
  });
});

describe("отправка", () => {
  let social: MemorySocialStore;
  let sent: Array<{ chat: number; text: string }>;
  let channelFails: boolean;
  const deps = (): FounderDigestDeps => ({
    tasks: async () => [],
    team: async () => [member(11, "vika", iso("2026-10-07T12:00")), member(9, "founder", null)],
    founders: () => [9, 10],
    social,
    memberCount: async () => {
      if (channelFails) throw new Error("Forbidden");
      return 1240;
    },
    send: async (chat, text) => sent.push({ chat, text }),
  });

  beforeEach(() => {
    vi.stubEnv("NIKA_TG_CHANNEL", "@nika");
    social = new MemorySocialStore();
    sent = [];
    channelFails = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("только фаундерам, одним сообщением; повторный проход тикера не шлёт второй раз", async () => {
    expect(await dispatchFounderDigest(deps(), msk("2026-10-07T22:30"))).toBe("22:30 2026-10-07");
    expect(await dispatchFounderDigest(deps(), msk("2026-10-07T22:45"))).toBeNull();
    expect(await dispatchFounderDigest(deps(), msk("2026-10-08T00:30"))).toBeNull(); // всё ещё слот 22:30 7-го
    expect(sent.map((s) => s.chat)).toEqual([9, 10]);
    expect(social.snapshots.filter((s) => s.platform === "telegram")).toHaveLength(1);
    expect(await dispatchFounderDigest(deps(), msk("2026-10-08T10:00"))).toBe("10:00 2026-10-08");
    expect(sent).toHaveLength(4);
  });

  it("ошибка Telegram не роняет сводку", async () => {
    channelFails = true;
    await dispatchFounderDigest(deps(), msk("2026-10-07T10:05"));
    expect(sent[0].text).toContain("TG-канал: не удалось получить");
    expect(sent[0].text).toContain("Instagram: ещё ни разу не вносили");
  });
});
