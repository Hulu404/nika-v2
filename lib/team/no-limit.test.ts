import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { startTaskDraft } from "./ai/assistant";
import { validateIntent } from "./ai/intent";
import { NOW, SALMA, TEAM, call, harness, reply } from "./ai/test-harness";
import { MemoryRsvpStore, MemoryWeekStore, createCoffeeTasks } from "./coffee-run-week";
import { MemoryEventStore } from "./events";
import { MemoryTeamForms } from "./form";
import { handleTeamTaskUpdate, syncTeamTaskMembers, type TeamTaskDeps } from "./tasks";

const DIMA = 9;

/**
 * У одного человека может быть сколько угодно задач в любом статусе: лимита
 * «до четырёх» (слоты из миграции 039) в «Пятнице» нет ни на одном пути.
 */
describe("никаких лимитов на число задач у человека", () => {
  beforeEach(() => vi.stubEnv("TEAM_FOUNDER_IDS", "8,9"));
  afterEach(() => vi.unstubAllEnvs());

  it("10 задач Сальме разными способами: все видны в «Мои задачи», «Взял в работу» срабатывает на каждой", async () => {
    const h = harness();
    const store = h.tasks;
    await syncTeamTaskMembers({ store }, NOW, TEAM);
    const screens: Array<{ chat: number; text: string }> = [];
    const deps: TeamTaskDeps = { store, forms: new MemoryTeamForms(), findMember: async (id) => TEAM.find((m) => m.chat_id === id) ?? null, listTeam: async () => TEAM };
    const bot = new Bot("999:test", { botInfo: { id: 999, is_bot: true, first_name: "Пятница", username: "t_bot" } as UserFromGetMe });
    let mid = 5000;
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string };
      if (method === "sendMessage" || method === "editMessageText") screens.push({ chat: p.chat_id, text: String(p.text ?? "") });
      return { ok: true, result: { message_id: ++mid, date: 1, chat: { id: p.chat_id, type: "private" } } } as never;
    });
    bot.use((ctx) => handleTeamTaskUpdate(ctx, deps, NOW).then(() => {}));
    let id = 0;
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x", username: TEAM.find((m) => m.chat_id === from)!.username! });
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    const send = (text: string, from: number) => bot.handleUpdate({ update_id: ++id, message: { message_id: ++mid, date: 1, text, chat: chat(from), from: user(from),
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(/\s/)[0].length }] } : {}) } } as Update);
    const press = (data: string, from: number) => bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
      message: { message_id: 1, date: 1, text: "x", chat: chat(from) } } } as Update);

    // 1–2. /assign списком.
    await send("/assign\nПост 1 / пт 18:00 / @salmasxsx\nПост 2 / пт 18:00 / @salmasxsx", DIMA);
    // 3–4. «➕ Раздать задачи отделу» — тот же ввод списком.
    await press("tk:u", DIMA);
    await send("Пост 3 / пт 18:00 / @salmasxsx\nПост 4 / пт 18:00 / @salmasxsx", DIMA);
    // 5. Ассистент: одна задача.
    h.script = [call("create_task", { assignees: [{ name: "Сальме" }], what: "Пост 5", due: "2026-10-16" })];
    await h.say("поставь Сальме пост 5", DIMA);
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    // 6–7. Ассистент: пакет.
    h.script = [call("create_task", { tasks: [6, 7].map((n) => ({ assignees: [{ name: "Сальме" }], what: `Пост ${n}`, due: "2026-10-16" })) }), reply("")];
    await h.say("Сальме пост 6 и пост 7", DIMA);
    await h.press(h.button("✅ Создать все")!, DIMA);
    // 8. Шаблон кофе-рана: ответственная за ивенты по умолчанию — Сальма.
    const events = new MemoryEventStore();
    const ev = await events.create({ kind: "club_event", club: "run", format: "coffee_run", spot: "usachevo", title: "Кофе-ран · Усачёва",
      starts_at: new Date("2026-10-18T07:00:00Z").toISOString(), place: null, responsible_chat_id: null, created_by: DIMA }, NOW);
    const api = { sendMessage: async () => ({ message_id: 1 }), editMessageText: async () => true };
    const coffee = await createCoffeeTasks({ weeks: new MemoryWeekStore(), events, rsvp: new MemoryRsvpStore(), tasks: store, forms: new MemoryTeamForms(),
      listTeam: async () => TEAM, enabled: async () => true }, api, "2026-10-12", ev, DIMA, TEAM, NOW);
    expect(coffee.filter((t) => t.assignee_id === SALMA)).toHaveLength(1);
    // 9–10. «📋 Сделать задачей» из плана развития — дважды.
    for (const n of [9, 10]) {
      const capture = { reply: async (text: string, other?: { reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } }) => {
        h.sent.push({ method: "sendMessage", chat: DIMA, text, buttons: (other?.reply_markup?.inline_keyboard ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data })) });
        return { message_id: 700 + n };
      }, api: { editMessageText: async () => true } } as never;
      const parsed = validateIntent({ intent: "create_task", what: `Пост ${n}`, due: "2026-10-16", assignees: [{ name: "Сальма", qualifier: null }] });
      await startTaskDraft(capture, h.deps, DIMA, parsed, { roadmapItemId: n, picks: { a0: SALMA } }, NOW);
      await h.press(h.button("✅ Подтвердить")!, DIMA);
    }

    const mine = (await store.listMyAssigned(SALMA)).filter((t) => t.assignee_id === SALMA);
    expect(mine).toHaveLength(10);
    expect(mine.every((t) => t.status === "open")).toBe(true);
    // «Мои задачи»: все 10 на одной странице.
    await send("/tasks", SALMA);
    const list = screens.filter((s) => s.chat === SALMA).at(-1)!.text;
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 10]) expect(list).toContain(`Пост ${n}`);
    expect(list).toContain("пейсеры и договорённости");
    // «Взял в работу» — на каждой.
    for (const t of mine) await press(`tk:s:take:${t.id}`, SALMA);
    const after = (await store.listMyAssigned(SALMA)).filter((t) => t.assignee_id === SALMA);
    expect(after.map((t) => t.status)).toEqual(Array(10).fill("taken"));
  });
});
