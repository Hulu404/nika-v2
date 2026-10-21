import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase вместо базы: запоминаем, что ушло в insert, и умеем отказать по колонке.
const inserted: Array<Record<string, unknown>> = [];
let failConsentColumn = false;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }),
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
    source: "coffeerunsurfsport", spot: "usachevo", run_date: "2026-10-25", ...extra }),
});

describe("POST /api/coffeerun-signup: согласие", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME", "mynikarun_bot");
    inserted.length = 0;
    failConsentColumn = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("с согласием пишет consent_at, спот, дату 25.10 и темп; отдаёт ссылку на бота", async () => {
    const res = await POST(body({ consent: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.confirmUrl).toMatch(/^https:\/\/t\.me\/mynikarun_bot\?start=cr_/);
    expect(inserted[0]).toMatchObject({ spot: "usachevo", run_date: "2026-10-25", source: "coffeerunsurfsport", pace: "6:30" });
    expect(typeof inserted[0].consent_at).toBe("string");
  });

  it("без согласия (старая страница) заявка валидна, consent_at не пишется", async () => {
    await POST(body());
    expect(inserted[0]).not.toHaveProperty("consent_at");
  });

  it("если миграция 050 ещё не применена, заявка всё равно сохраняется", async () => {
    failConsentColumn = true;
    const res = await POST(body({ consent: true }));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty("consent_at");
  });
});
