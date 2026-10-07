import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../data/memory-store";
import type { TrafficRow } from "../data/traffic";
import { parseIntent } from "../intent";
import { visibleSections } from "../sections";
import type { SectionRequest } from "../section";
import type { Intent, Subject } from "../types";
import { INSTAGRAM_OWNER_SETTING } from "../founders/constants";
import { MemorySocialForms } from "../founders/social";
import { MemorySocialStore } from "../founders/social-store";
import { createSocialHandler, trafficLines } from "./social";

const now = new Date("2026-10-07T12:00:00Z");
const OWNER: Subject = { chatId: 9, zone: "council", isOwner: true };
const COUNCIL: Subject = { chatId: 3, zone: "council", isOwner: false };

function intentOf(data: string): Intent {
  const parsed = parseIntent({ text: null, callbackData: data });
  if (parsed.kind !== "intent") throw new Error(`не разобралось: ${data}`);
  return parsed.intent;
}

describe("раздел «Соцсети»", () => {
  let social: MemorySocialStore;
  let forms: MemorySocialForms;
  let store: MemoryStore;
  let traffic: TrafficRow[];
  const fetchTraffic = vi.fn(async () => traffic);
  const handle = () => createSocialHandler({
    social: () => social, forms: () => forms, fetchTraffic, team: async () => [], founders: () => [9],
  });
  const req = (subject: Subject, intent: Intent): SectionRequest => ({
    subject,
    member: { chat_id: subject.chatId, username: null, display_name: null, zone: subject.zone, is_owner: subject.isOwner,
      invited_by: null, joined_at: now.toISOString(), last_seen_at: null, is_active: true, removed_at: null },
    intent, store, effects: { setCommands: async () => {} }, now, botUsername: "test",
  });

  beforeEach(async () => {
    vi.stubEnv("NIKA_TG_CHANNEL", "");
    social = new MemorySocialStore();
    forms = new MemorySocialForms();
    store = new MemoryStore();
    traffic = [];
    fetchTraffic.mockClear();
    for (const [chat_id, username] of [[9, "founder"], [5, "masha"]] as const)
      await store.upsertMember({ chat_id, username, zone: "smm", display_name: null, is_owner: chat_id === 9, invited_by: null }, now);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("виден фаундерам и не виден остальным зонам", () => {
    expect(visibleSections(OWNER)).toContain("tr");
    for (const zone of ["council", "events", "smm"] as const) expect(visibleSections({ chatId: 1, zone, isOwner: false })).not.toContain("tr");
  });

  it("не читает данные без доступа", async () => {
    expect(await handle()(req(COUNCIL, intentOf("d:tr:open")))).toEqual({ kind: "forbidden" });
    expect(fetchTraffic).not.toHaveBeenCalled();
  });

  it("рендерится на пустой базе: без снимков и переходов", async () => {
    const res = await handle()(req(OWNER, intentOf("d:tr:open")));
    expect(res.kind).toBe("screens");
    if (res.kind !== "screens") return;
    const { text, buttons } = res.screens[0];
    expect(text).toContain("TG-канал: снимков пока нет (не задан NIKA_TG_CHANNEL)");
    expect(text).toContain("Instagram: ещё ни разу не вносили");
    expect(text).toContain("Кто вносит Instagram: фаундеры (ответственный не назначен)");
    expect(text).toContain("Переходов по меткам за период нет");
    expect(buttons?.flat().map((b) => b.text)).toEqual(expect.arrayContaining(["Внести Instagram", "Кто вносит Instagram", "Сводка сейчас"]));
    expect(buttons?.flat().map((b) => b.data)).toContain("d:tr:summary:30d");
  });

  it("подписчики с приростом за сутки, неделю и месяц и датой снимка Instagram", async () => {
    const at = (iso: string) => new Date(iso);
    await social.addSnapshot({ platform: "instagram", followers: 3760, source: "manual", entered_by: 5 }, at("2026-09-30T08:00:00Z"));
    await social.addSnapshot({ platform: "instagram", followers: 3845, source: "manual", entered_by: 5 }, at("2026-10-06T08:00:00Z"));
    await social.addSnapshot({ platform: "instagram", followers: 3870, source: "manual", entered_by: 5 }, at("2026-10-06T18:10:00Z"));
    const res = await handle()(req(OWNER, intentOf("d:tr:summary:7d")));
    if (res.kind !== "screens") throw new Error();
    expect(res.screens[0].text).toContain("Instagram: 3 870 · +25 за сутки, +110 за неделю, нет данных за месяц · последний снимок 06.10");
  });

  it("переходы по меткам за выбранный период", async () => {
    traffic = [
      { code: "IGST-0310", label: "сторис", channel: "instagram", clicks: 50, visitors: 40, signupsCoffeerun: 6, signupsApp: 2 },
      { code: "TG-01", label: "", channel: "telegram", clicks: 10, visitors: 9, signupsCoffeerun: 1, signupsApp: 0 },
    ];
    const lines = trafficLines(traffic);
    expect(lines[0]).toBe("Переходы по меткам: 60, уникальных 49");
    expect(lines).toContain("Instagram: 50 переходов, 6 заявок, 2 регистраций");
    expect(lines).toContain("Метка IGST-0310 (сторис): 50 переходов");
    await handle()(req(OWNER, intentOf("d:tr:summary:pw")));
    expect(fetchTraffic).toHaveBeenCalledTimes(1);
  });

  it("«Кто вносит Instagram»: список участников и назначение", async () => {
    const list = await handle()(req(OWNER, intentOf("d:tr:own")));
    if (list.kind !== "screens") throw new Error();
    expect(list.screens[0].buttons?.flat().map((b) => b.data)).toEqual(expect.arrayContaining(["d:tr:own:5", "d:tr:own:0"]));
    const done = await handle()(req(OWNER, intentOf("d:tr:own:5")));
    if (done.kind !== "screens") throw new Error();
    expect(social.settings.get(INSTAGRAM_OWNER_SETTING)).toBe("5");
    expect(done.screens[0].text).toContain("Instagram вносит: @masha");
    await handle()(req(OWNER, intentOf("d:tr:own:0")));
    expect(social.settings.has(INSTAGRAM_OWNER_SETTING)).toBe(false);
  });

  it("«Внести Instagram» открывает приём числа", async () => {
    const res = await handle()(req(OWNER, intentOf("d:tr:ig")));
    if (res.kind !== "screens") throw new Error();
    expect(res.screens[0].text).toContain("Сколько сейчас подписчиков в Instagram?");
    expect(await forms.get(9)).not.toBeNull();
  });

  it("«Сводка сейчас» без отметки дедупа", async () => {
    const res = await handle()(req(OWNER, intentOf("d:tr:dig")));
    if (res.kind !== "screens") throw new Error();
    expect(res.screens[0].text).toMatch(/^Сводка \d\d:\d\d · 7 октября/);
    expect(res.screens[0].text).toContain("✅ Выполнено: 0");
    expect(social.claimed.size).toBe(0);
  });
});
