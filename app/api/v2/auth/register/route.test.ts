import { describe, it, expect, vi, beforeEach } from "vitest";

const signUp = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createServerComponentClient: vi.fn(async () => ({ auth: { signUp } })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/consents", () => ({
  recordConsents: vi.fn(async () => null),
  requestMeta: vi.fn(() => ({ ip: "1.2.3.4", userAgent: "ua" })),
}));
vi.mock("@/lib/public-origin", () => ({ getPublicOrigin: () => "https://www.mynika.online" }));

import { POST } from "@/app/api/v2/auth/register/route";
import { recordConsents } from "@/lib/consents";

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v2/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ok = { email: "A@b.ru", password: "password1", acceptOffer: true, acceptPd: true };

beforeEach(() => {
  signUp.mockReset();
  vi.mocked(recordConsents).mockClear();
});

describe("POST /api/v2/auth/register", () => {
  it("без обеих отметок аккаунт не создаётся", async () => {
    const res = await POST(req({ ...ok, acceptPd: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "consents" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("короткий пароль и кривая почта отклоняются", async () => {
    expect((await POST(req({ ...ok, password: "short" }))).status).toBe(400);
    expect((await POST(req({ ...ok, email: "nope" }))).status).toBe(400);
  });

  it("при сессии согласия пишутся в журнал, почта приводится к нижнему регистру", async () => {
    signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: {} }, error: null });
    const res = await POST(req(ok));
    expect(await res.json()).toEqual({ ok: true, confirm: false });
    expect(signUp.mock.calls[0][0].email).toBe("a@b.ru");
    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toBe("https://www.mynika.online/auth/callback?next=/start");
    expect(recordConsents).toHaveBeenCalledWith(
      "u1",
      [
        { type: "offer", granted: true },
        { type: "pd", granted: true },
      ],
      { ip: "1.2.3.4", userAgent: "ua", source: "signup" },
    );
  });

  it("включено подтверждение почты: confirm, журнал не пишется", async () => {
    signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: null }, error: null });
    expect(await (await POST(req(ok))).json()).toEqual({ ok: true, confirm: true });
    expect(recordConsents).not.toHaveBeenCalled();
  });

  it("занятая почта даёт 409", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "user_already_exists", message: "" } });
    expect((await POST(req(ok))).status).toBe(409);
    signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [] }, session: null }, error: null });
    expect((await POST(req(ok))).status).toBe(409);
  });
});
