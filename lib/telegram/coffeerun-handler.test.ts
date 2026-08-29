import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Путь подтверждения целиком: deep-link → строка заявки из базы → текст, который
 * человек читает в личке. Базу подменяем, всё остальное — настоящее.
 *
 * Смысл теста: заявка со спота Лужники обязана подтверждаться Лужниками. Раньше
 * бот брал ближайший забег вообще, и заявка из Лужников получала адрес Усачёвой —
 * ровно эта регрессия здесь и ловится.
 */

/** Строка, которую «вернёт» Supabase на select по токену. */
let row: Record<string, unknown> | null = null;
/** Патчи, ушедшие в update — проверяем, что подтверждение вообще записывается. */
const updates: Record<string, unknown>[] = [];

vi.mock("./supabase", () => ({
  tgAdmin: () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      from: self,
      select: self,
      eq: self,
      is: self,
      in: self,
      order: self,
      limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    });
    return chain;
  },
}));

const { handleCoffeeRunStart, handleCoffeeRunByUsername } = await import("./coffeerun");
const { COFFEE_RUNS } = await import("../coffeerun/run");

const TOKEN = "cr_" + "a".repeat(32);

/** Минимальный ctx: нам важен только текст ответа. */
function makeCtx(username = "annaruns") {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      from: { id: 4242, username, first_name: "Аня" },
      reply: async (text: string) => {
        replies.push(text);
      },
    },
  };
}

function signupRow(spot: string, runDate: string) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Аня",
    email: "anna@mail.ru",
    tg_username: "annaruns",
    confirmed_at: null,
    spot,
    run_date: runDate,
  };
}

beforeEach(() => {
  row = null;
  updates.length = 0;
});

describe("подтверждение записи — бот отвечает про спот заявки", () => {
  it.each(COFFEE_RUNS.map((run) => [run.spot, run] as const))(
    "deep-link заявки со спота %s приводит адрес и день этого спота",
    async (_spot, run) => {
      row = signupRow(run.spot, run.date);
      const { ctx, replies } = makeCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handleCoffeeRunStart(ctx as any, TOKEN);

      expect(replies).toHaveLength(1);
      const text = replies[0];

      expect(text).toContain(run.address);
      expect(text).toContain(run.dateLabel);
      expect(text).toContain(run.weekday);

      // И ни слова про соседний спот — именно этим ломалось поведение.
      for (const other of COFFEE_RUNS.filter((r) => r.spot !== run.spot)) {
        expect(text).not.toContain(other.address);
        expect(text).not.toContain(other.dateLabel);
      }

      expect(updates[0]).toMatchObject({ tg_chat_id: 4242 });
    },
  );

  it.each(COFFEE_RUNS.map((run) => [run.spot, run] as const))(
    "просто /start по нику — тоже спот %s из заявки, а не ближайший забег",
    async (_spot, run) => {
      row = signupRow(run.spot, run.date);
      const { ctx, replies } = makeCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handled = await handleCoffeeRunByUsername(ctx as any);

      expect(handled).toBe(true);
      expect(replies[0]).toContain(run.address);
      expect(replies[0]).toContain(run.weekday);
    },
  );

  it("строка со спотом, которого нет в COFFEE_RUNS, не выдаёт чужой адрес молча", async () => {
    // Такое возможно, если спот переименовали в коде, а строки в базе остались.
    row = signupRow("спота-больше-нет", "2026-09-06");
    const { ctx, replies } = makeCtx();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCoffeeRunStart(ctx as any, TOKEN);

    // Дата в строке всё ещё опознаётся — по ней и отвечаем.
    const byDate = COFFEE_RUNS.find((r) => r.date === "2026-09-06")!;
    expect(replies[0]).toContain(byDate.address);
  });
});
