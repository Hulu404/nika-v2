import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteUser = vi.fn(async () => ({ error: null }));
const signOut = vi.fn(async () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  createServiceRoleClient: () => ({ auth: { admin: { deleteUser } } }),
}));
vi.mock("@/lib/v2/http", async (orig) => ({
  ...(await orig<typeof import("@/lib/v2/http")>()),
  getAuthed: vi.fn(async () => ({ supabase: { auth: { signOut } }, user: { id: "u1" } })),
}));

import { DELETE } from "@/app/api/v2/account/route";

const req = (body: unknown) =>
  new Request("http://localhost/api/v2/account", { method: "DELETE", body: JSON.stringify(body) });

beforeEach(() => {
  deleteUser.mockClear();
  signOut.mockClear();
});

describe("DELETE /api/v2/account", () => {
  it("без слова «удалить» ничего не удаляется", async () => {
    const res = await DELETE(req({ confirm: "да" }));
    expect(res.status).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("со словом удаляет пользователя (регистр и пробелы неважны) и сбрасывает сессию", async () => {
    const res = await DELETE(req({ confirm: "  Удалить " }));
    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(signOut).toHaveBeenCalled();
  });
});
