import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ответ переклички ложится в заявку (coffee_run_signups.rollcall_answer), а
 * ошибка этой записи не ломает ни ответ человеку, ни строку организатору.
 */
const db = vi.hoisted(() => ({
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  /** По каким фильтрам строка «нашлась»: tg_chat_id или tg_username. */
  matchBy: "tg_chat_id" as "tg_chat_id" | "tg_username" | "none",
  fail: false,
}));
const admin = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("./supabase", () => ({
  tgAdmin: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};
      const b = {
        update(p: Record<string, unknown>) {
          patch = p;
          return b;
        },
        eq(col: string, v: unknown) {
          filters[col] = v;
          return b;
        },
        select() {
          return b;
        },
        then(resolve: (v: unknown) => void) {
          db.updates.push({ patch, filters: { ...filters } });
          if (db.fail) return resolve({ data: null, error: { message: "boom" } });
          const hit = db.matchBy !== "none" && db.matchBy in filters;
          resolve({ data: hit ? [{ id: "s1" }] : [], error: null });
        },
      };
      return b;
    },
  }),
}));
vi.mock("./send", () => ({
  sendBotMessage: vi.fn(async (_chatId: number, text: string) => {
    admin.lines.push(text);
  }),
}));

const { handleCoffeeRunPollAnswer } = await import("./coffeerun-poll");
const { buildPollCallback } = await import("./poll-copy");
const { __resetPollStateForTests, addAdminChat, startPoll, pollSummary } = await import("./poll-store");

const RUN_DATE = "2026-11-15";

function ctx(data: string) {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      from: { id: 42, first_name: "Ника", username: "Nika_Run" },
      callbackQuery: { data },
      answerCallbackQuery: vi.fn(async () => true),
      editMessageReplyMarkup: vi.fn(async () => true),
      reply: vi.fn(async (text: string) => {
        replies.push(text);
      }),
    } as never,
  };
}

describe("перекличка → coffee_run_signups.rollcall_answer", () => {
  beforeEach(() => {
    __resetPollStateForTests();
    db.updates = [];
    db.matchBy = "tg_chat_id";
    db.fail = false;
    admin.lines = [];
    addAdminChat(1);
    startPoll(RUN_DATE, "rollcall");
  });

  it("«да» — пишет yes в заявку этого чата на этот забег; сводка и организатор как раньше", async () => {
    const { ctx: c, replies } = ctx(buildPollCallback("yes", RUN_DATE, "rollcall"));
    await handleCoffeeRunPollAnswer(c);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].filters).toEqual({ run_date: RUN_DATE, tg_chat_id: 42 });
    expect(db.updates[0].patch.rollcall_answer).toBe("yes");
    expect(typeof db.updates[0].patch.rollcall_answered_at).toBe("string");
    expect(pollSummary().yes).toHaveLength(1);
    expect(admin.lines).toHaveLength(1);
    expect(replies).toHaveLength(1);
  });

  it("по чату заявки нет — ищет по нику (нормализованному)", async () => {
    db.matchBy = "tg_username";
    const { ctx: c } = ctx(buildPollCallback("no", RUN_DATE, "rollcall"));
    await handleCoffeeRunPollAnswer(c);
    expect(db.updates.map((u) => u.filters)).toEqual([
      { run_date: RUN_DATE, tg_chat_id: 42 },
      { run_date: RUN_DATE, tg_username: "nika_run" },
    ]);
    expect(db.updates[1].patch.rollcall_answer).toBe("no");
  });

  it("устаревшая кнопка переклички тоже пишется в заявку", async () => {
    startPoll("2026-11-22", "rain");
    const { ctx: c } = ctx(buildPollCallback("yes", RUN_DATE, "rollcall"));
    await handleCoffeeRunPollAnswer(c);
    expect(db.updates[0].filters.run_date).toBe(RUN_DATE);
    expect(admin.lines[0]).toContain("В сводку не считаю");
  });

  it("ошибка базы — только в лог: человек получает ответ, организатор — строку", async () => {
    db.fail = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx: c, replies } = ctx(buildPollCallback("yes", RUN_DATE, "rollcall"));
    await handleCoffeeRunPollAnswer(c);
    expect(replies).toHaveLength(1);
    expect(admin.lines).toHaveLength(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("опрос про дождь в заявку не пишется", async () => {
    startPoll(RUN_DATE, "rain");
    const { ctx: c } = ctx(buildPollCallback("yes", RUN_DATE, "rain"));
    await handleCoffeeRunPollAnswer(c);
    expect(db.updates).toHaveLength(0);
  });
});
