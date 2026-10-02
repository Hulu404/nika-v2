import { describe, it, expect } from "vitest";
import { parseAvatar } from "@/lib/v2/avatar";

describe("avatar_url", () => {
  it("фото, готовый аватар, пусто", () => {
    expect(parseAvatar("photo:u1/avatar.webp?v=1")).toEqual({ kind: "photo", path: "u1/avatar.webp" });
    expect(parseAvatar("preset:3")).toEqual({ kind: "preset", n: 3 });
    expect(parseAvatar("preset:9")).toBeNull();
    expect(parseAvatar(null)).toBeNull();
  });
});
