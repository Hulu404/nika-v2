import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { table: string; op: string; payload: unknown }[] = [];
function table(name: string) {
  return {
    update: (payload: unknown) => {
      calls.push({ table: name, op: "update", payload });
      return { eq: async () => ({ error: null }) };
    },
    upsert: async (payload: unknown) => {
      calls.push({ table: name, op: "upsert", payload });
      return { error: null };
    },
  };
}
vi.mock("@/lib/v2/http", async (orig) => ({
  ...(await orig<typeof import("@/lib/v2/http")>()),
  getAuthed: vi.fn(async () => ({ supabase: { from: table }, user: { id: "u1" } })),
}));

import { PATCH } from "@/app/api/v2/profile/route";

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v2/profile", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  calls.length = 0;
});

describe("PATCH /api/v2/profile", () => {
  it("имя уходит в users, ответы и finish в profiles", async () => {
    const res = await PATCH(req({ name: "Аня", gender: "female", cycle: "yes", behaviors: ["sleep", "ate", "heat"], finish: true }));
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({ table: "users", op: "update", payload: { display_name: "Аня" } });
    const up = calls[1].payload as Record<string, unknown>;
    expect(calls[1].table).toBe("profiles");
    expect(up).toMatchObject({ user_id: "u1", gender: "female", cycle: "on", behaviors: ["sleep", "ate", "heat"] });
    expect(typeof up.onboarded_at).toBe("string");
  });

  it("невалидные поля: 400 со списком, в базу ничего не пишется", async () => {
    const res = await PATCH(req({ gender: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_fields", fields: ["gender"] });
    expect(calls).toHaveLength(0);
  });
});
