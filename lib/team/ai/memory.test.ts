import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMember } from "../access";
import { ROSTER } from "../roster";
import { HISTORY_MAX_CHARS, MemoryStateStore, MemoryTurnStore, TURNS_KEPT, dialogMessages, shownListText, trimHistory } from "./memory";
import { assistantPrompt } from "./prompt";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-13T14:05");
const team: TeamMember[] = ROSTER.map((r, i) => ({
  chat_id: i + 1, username: r.username, display_name: r.firstName, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, first_name: r.firstName, title: r.title,
  departments: r.departments, name_aliases: r.aliases,
}));

describe("память диалога", () => {
  it("не больше 12 последних реплик и не старше 6 часов", async () => {
    const turns = new MemoryTurnStore();
    await turns.add(1, "user", "давно", msk("2026-10-13T07:00"));
    for (let i = 0; i < 15; i++) await turns.add(1, i % 2 ? "assistant" : "user", `реплика ${i}`, new Date(NOW.getTime() + i * 1000));
    const recent = await turns.recent(1, new Date(NOW.getTime() + 20_000));
    expect(recent).toHaveLength(TURNS_KEPT);
    expect(recent[0].content).toBe("реплика 3");
    expect(recent.some((t) => t.content === "давно")).toBe(false);
    expect(await turns.recent(1, msk("2026-10-13T21:00"))).toEqual([]);
    expect(await turns.recent(2, NOW)).toEqual([]);
  });

  it("история для модели — не больше ~8000 символов, старые отбрасываются первыми", () => {
    // 12 реплик по 700 символов = 8400: самая старая не влезает.
    const turns = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `#${i}`.padEnd(700, "я"), created_at: "" }));
    const kept = trimHistory(turns);
    expect(kept.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(kept.map((t) => t.content.split("я")[0])).toEqual(["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8", "#9", "#10", "#11"]);
  });

  it("длинная реплика усекается", async () => {
    const turns = new MemoryTurnStore();
    await turns.add(1, "user", "а".repeat(2000), NOW);
    expect((await turns.recent(1, NOW))[0].content.length).toBe(600);
  });

  it("черновик и последний список — у каждого свои", async () => {
    const state = new MemoryStateStore();
    await state.setDraft(1, 7, NOW);
    await state.setList(1, { kind: "tasks", items: [{ n: 1, id: 42, label: "Анонс" }] }, NOW);
    expect(await state.get(1)).toEqual({ draft_id: 7, last_list: { kind: "tasks", items: [{ n: 1, id: 42, label: "Анонс" }] } });
    expect(await state.get(2)).toEqual({ draft_id: null, last_list: null });
  });

  it("сообщения для модели: система, прошлые реплики, заметки инструментов, новое сообщение", () => {
    const msgs = dialogMessages("SYS", [
      { role: "user", content: "поставь Маше задачу", created_at: "" },
      { role: "tool", content: "create_task → предпросмотр", created_at: "" },
      { role: "assistant", content: "Проверь черновик.", created_at: "" },
    ], "ой, не Маше, а Сальме");
    expect(msgs).toEqual([
      { role: "system", text: "SYS" },
      { role: "user", text: "поставь Маше задачу" },
      { role: "assistant", text: "(сделано: create_task → предпросмотр)" },
      { role: "assistant", text: "Проверь черновик." },
      { role: "user", text: "ой, не Маше, а Сальме" },
    ]);
  });
});

describe("контекст в системной инструкции", () => {
  beforeEach(() => vi.stubEnv("TEAM_FOUNDER_IDS", "8,9"));
  afterEach(() => vi.unstubAllEnvs());

  it("время по Москве, команда, отделы, черновик и список с номерами", () => {
    const text = assistantPrompt({ now: NOW, team, senderId: 8,
      draft: "Открытый черновик: задача «Найти пейсеров», исполнитель Маша",
      list: shownListText({ kind: "tasks", items: [{ n: 1, id: 42, label: "Анонс · @ananas_2711" }, { n: 2, id: 43, label: "Рилсы · @tora_co" }] }) });
    expect(text).toContain("Сейчас вторник 2026-10-13, 14:05 по Москве");
    expect(text).toContain("Тебе пишет Али (фаундер");
    expect(text).toContain("- Маша, Ивент-отдел, @gusarovame");
    expect(text).toContain("- Ивент-отдел: Маша, Сальма");
    expect(text).toContain("Открытый черновик: задача «Найти пейсеров»");
    expect(text).toContain("Последний показанный список (задачи):\n1. #42 Анонс · @ananas_2711\n2. #43 Рилсы · @tora_co");
    expect(text).not.toMatch(/\+7|телефон/i);
  });

  it("правила поведения: подтверждение, правки, номера, вне возможностей, без шаблона", () => {
    const text = assistantPrompt({ now: NOW, team, senderId: 8 });
    for (const rule of [
      "на «ты», от женского лица", "задай один короткий вопрос", "«✅ Подтвердить»", "«Удалить задачу» — это отменить",
      "вызови тот же инструмент заново", "коротко извинись", "из последнего показанного списка", "не выбирай сама",
      "не выдумывай", "Могу закрыть только свои задачи или поставленные тобой", "/moved", "одной дружелюбной фразой",
      "Без эмодзи-перегруза",
    ]) expect(text, rule).toContain(rule);
    expect(text).not.toContain("Не поняла. Я умею");
  });

  it("не-фаундеру — пометка, что видит только свои задачи", () => {
    expect(assistantPrompt({ now: NOW, team, senderId: 2 })).toContain("Тебе пишет Настя (не фаундер: видит только свои задачи и поставленные им)");
  });
});
