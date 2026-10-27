import { describe, expect, it } from "vitest";
import { isSoldOut } from "./seats";
import { SESSIONS } from "./sessions";

describe("isSoldOut", () => {
  const session = SESSIONS[0];

  it("на /stretch 16 ковриков", () => {
    expect(session.capacity).toBe(16);
  });
  it("распродано, только когда оплачены все места", () => {
    expect(isSoldOut(15, session)).toBe(false);
    expect(isSoldOut(16, session)).toBe(true);
    expect(isSoldOut(Number.POSITIVE_INFINITY, session)).toBe(true);
  });
});
