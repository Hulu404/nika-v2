import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Вебхук бота данных: секрет, дедуп и «всегда 200». Бот и база подменены:
 * здесь проверяется только сам роут.
 */

const handleUpdate = vi.fn<(update: unknown) => Promise<void>>();
vi.mock("@/lib/databot/bot", () => ({ handleUpdate: (u: unknown) => handleUpdate(u) }));

/** processed_updates в памяти: повтор пары (bot, update_id) даёт 23505. */
const seen = new Set<string>();
const inserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/telegram/supabase", () => ({
  tgAdmin: () => ({
    from: (table: string) => ({
      insert: async (row: { update_id: number; bot: string }) => {
        expect(table).toBe("processed_updates");
        inserts.push(row);
        const key = `${row.bot}:${row.update_id}`;
        if (seen.has(key)) return { error: { code: "23505", message: "duplicate key" } };
        seen.add(key);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");

const SECRET = "test-databot-secret";

function request(body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("https://example.test/api/telegram/databot-webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const update = (id: number) => ({
  update_id: id,
  message: { message_id: 1, date: 0, chat: { id: 1001, type: "private" }, text: "привет" },
});

beforeEach(() => {
  vi.stubEnv("DATABOT_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("DATABOT_TOKEN", "123:test-token");
  handleUpdate.mockReset();
  handleUpdate.mockResolvedValue(undefined);
  seen.clear();
  inserts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("databot-webhook — секрет", () => {
  it("неверный секрет → 401, тело не читается и не обрабатывается", async () => {
    const req = request(update(1), "wrong");
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(req.bodyUsed).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("без заголовка → 401", async () => {
    const res = await POST(request(update(1), null));
    expect(res.status).toBe(401);
  });

  it("секрет не задан в окружении → 401 даже для пустого заголовка", async () => {
    vi.stubEnv("DATABOT_WEBHOOK_SECRET", "");
    const res = await POST(request(update(1), ""));
    expect(res.status).toBe(401);
  });

  it("верный секрет → 200 и апдейт обработан", async () => {
    const res = await POST(request(update(7)));
    expect(res.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(inserts).toEqual([{ update_id: 7, bot: "data" }]);
  });
});

describe("databot-webhook — тело и дедуп", () => {
  it("нечитаемое тело → 400", async () => {
    const res = await POST(request("{не json"));
    expect(res.status).toBe(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("тот же update_id второй раз не обрабатывается", async () => {
    expect((await POST(request(update(42)))).status).toBe(200);
    expect((await POST(request(update(42)))).status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });

  it("дедуп ведётся с bot = 'data': тот же номер у другого бота не мешает", async () => {
    seen.add("team:42");
    seen.add("nika:42");
    await POST(request(update(42)));
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("databot-webhook — всегда 200", () => {
  it("ошибка обработчика → всё равно 200", async () => {
    handleUpdate.mockRejectedValue(new Error("boom"));
    const res = await POST(request(update(9)));
    expect(res.status).toBe(200);
  });

  it("без DATABOT_TOKEN → 200 и ничего не обрабатывается", async () => {
    vi.stubEnv("DATABOT_TOKEN", "");
    const res = await POST(request(update(10)));
    expect(res.status).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();
  });
});
