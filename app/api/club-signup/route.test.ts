import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase вместо базы: что ушло в insert/update и какая строка «уже есть».
const inserted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];
let existing: Array<Record<string, unknown>> = [];
vi.mock("@supabase/supabase-js", () => {
  const chain = () => {
    const q = { eq: () => q, limit: async () => ({ data: existing, error: null }) };
    return q;
  };
  return {
    createClient: () => ({
      from: () => ({
        select: () => chain(),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        },
        update: (row: Record<string, unknown>) => ({
          eq: async () => {
            updated.push(row);
            return { error: null };
          },
        }),
      }),
    }),
  };
});

import { POST } from "./route";

const form = {
  name: "Ника",
  telegram: "@Nika_Test",
  email: "nika@example.com",
  level: "first",
  mat: "studio",
  towel: "yes",
  water: "no",
  consent: true,
  club: "stretch",
  event_date: "2026-11-01",
  source: "stretch",
};
const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://x/api/club-signup", {
      method: "POST",
      body: JSON.stringify({ ...form, ...extra }),
    }),
  );

describe("POST /api/club-signup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME", "nika_cofferun_signupsbot");
    inserted.length = 0;
    updated.length = 0;
    existing = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("пишет заявку pending с ценой из конфига и отдаёт ссылку st_ в бот", async () => {
    const res = await post({ amount_rub: 1 });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.confirmUrl).toMatch(/^https:\/\/t\.me\/nika_cofferun_signupsbot\?start=st_[a-f0-9]{32}$/);
    expect(json.paid).toBe(false);
    expect(inserted[0]).toMatchObject({
      club: "stretch",
      event_date: "2026-11-01",
      event_time: "10:30",
      tg_username: "nika_test",
      level: "first",
      mat: "studio",
      towel: true,
      water: false,
      amount_rub: 1000,
    });
    expect(typeof inserted[0].consent_at).toBe("string");
    expect(inserted[0]).not.toHaveProperty("payment_status");
  });

  it("без согласия и с кривыми полями отвечает 422 со списком полей", async () => {
    const res = await post({ consent: false, telegram: "@x", towel: "maybe" });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.fields).toEqual(expect.arrayContaining(["consent", "telegram", "towel"]));
    expect(inserted).toHaveLength(0);
  });

  it("повторная форма обновляет заявку и сохраняет прежний токен", async () => {
    existing = [{ id: "a", confirm_token: "f".repeat(32), payment_status: "pending" }];
    const json = await (await post()).json();

    expect(inserted).toHaveLength(0);
    expect(updated[0]).toMatchObject({ confirm_token: "f".repeat(32), amount_rub: 1000 });
    expect(json.confirmUrl).toContain(`st_${"f".repeat(32)}`);
  });

  it("у оплаченной заявки сумму не трогает и говорит paid", async () => {
    existing = [{ id: "a", confirm_token: "e".repeat(32), payment_status: "paid" }];
    const json = await (await post()).json();

    expect(json.paid).toBe(true);
    expect(updated[0]).not.toHaveProperty("amount_rub");
  });

  it("неизвестный клуб — 404, в базу ничего", async () => {
    const res = await post({ club: "boxing" });
    expect(res.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
});
