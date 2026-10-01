import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let currentUser: { id: string } | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));

import { middleware } from "./middleware";

const req = (path: string) => new NextRequest(new URL(path, "https://www.mynika.online"));

beforeEach(() => {
  currentUser = null;
});

describe("middleware: корень", () => {
  it("гостю отдаёт лендинг с публичным кэшем и Vary: Cookie, без CSP", async () => {
    const res = await middleware(req("/"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/landing.html");
    expect(res.headers.get("cache-control")).toContain("public, max-age=300");
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("вошедшему отдаёт приложение без кэша и без CSP", async () => {
    currentUser = { id: "u1" };
    const res = await middleware(req("/"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/app/index.html");
    expect(res.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("API пропускает дальше без перезаписи", async () => {
    currentUser = { id: "u1" };
    const res = await middleware(req("/api/v2/me"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
