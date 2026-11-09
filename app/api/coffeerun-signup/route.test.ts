import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase вместо базы: запоминаем, что ушло в insert, и умеем отказать по колонке.
const inserted: Array<Record<string, unknown>> = [];
const filters: Array<[string, unknown]> = [];
let existingRows: Array<{ id: string; confirm_token: string }> = [];
const updated: Array<Record<string, unknown>> = [];
let failConsentColumn = false;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const query = {
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
          order: () => query,
          limit: async () => ({ data: existingRows }),
        };
        return query;
      },
      update: (row: Record<string, unknown>) => ({
        eq: async (key: string, value: unknown) => {
          filters.push([key, value]);
          updated.push(row);
          return { error: null };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        if (failConsentColumn && "consent_at" in row) {
          return { error: { message: "Could not find the 'consent_at' column of 'coffee_run_signups' in the schema cache" } };
        }
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

const body = (extra: Record<string, unknown> = {}) => new Request("http://x/api/coffeerun-signup", {
  method: "POST",
  body: JSON.stringify({ name: "Тест", telegram: "test_runner", email: "t@example.com", pace: "6:30",
    source: "coffeerunsurfsport", spot: "usachevo", run_date: "2026-11-01", ...extra }),
});

describe("POST /api/coffeerun-signup: согласие", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME", "mynikarun_bot");
    inserted.length = 0;
    updated.length = 0;
    filters.length = 0;
    existingRows = [];
    failConsentColumn = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("с согласием пишет consent_at, спот, дату 01.11 и темп; отдаёт ссылку на бота", async () => {
    const res = await POST(body({ consent: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.confirmUrl).toMatch(/^https:\/\/t\.me\/mynikarun_bot\?start=cr_/);
    expect(inserted[0]).toMatchObject({ spot: "usachevo", run_date: "2026-11-01", source: "coffeerunsurfsport", pace: "6:30" });
    expect(typeof inserted[0].consent_at).toBe("string");
  });

  it("без согласия (старая страница) заявка валидна, consent_at не пишется", async () => {
    await POST(body());
    expect(inserted[0]).not.toHaveProperty("consent_at");
  });

  it.each(["6:00", "7:00", "8:00"])("Cave: сохраняет дату, адрес и темп %s", async (pace) => {
    const res = await POST(body({
      spot: "cave", run_date: "2026-11-15", source: "coffeerunsurfcave",
      pace, consent: true, address: "Адрес из браузера не должен попасть в базу",
    }));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      spot: "cave", run_date: "2026-11-15", source: "coffeerunsurfcave",
      address: "Москва, Новокузнецкая улица, дом 7", pace,
    });
    expect(filters).toContainEqual(["spot", "cave"]);
    expect(filters).toContainEqual(["run_date", "2026-11-15"]);
  });

  it("повторная заявка Cave обновляет свою строку и сохраняет токен подтверждения", async () => {
    existingRows = [{ id: "cave-signup", confirm_token: "a".repeat(32) }];
    const res = await POST(body({ spot: "cave", run_date: "2026-11-01", source: "coffeerunsurfcave", pace: "6:00" }));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(0);
    expect(updated[0]).toMatchObject({
      spot: "cave", run_date: "2026-11-15", address: "Москва, Новокузнецкая улица, дом 7",
      confirm_token: "a".repeat(32), pace: "6:00",
    });
    expect(filters).toContainEqual(["id", "cave-signup"]);
    expect((await res.json()).confirmUrl).toContain("a".repeat(32));
  });

  it("если миграция 050 ещё не применена, заявка всё равно сохраняется", async () => {
    failConsentColumn = true;
    const res = await POST(body({ consent: true }));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty("consent_at");
  });
});
