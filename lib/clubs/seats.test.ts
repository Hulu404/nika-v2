import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countPaidSeats, isSoldOut, seatsLeftToShow } from "./seats";
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

/** База-заглушка: оплаченные строки с флагом counts_seat; hasColumn=false — до миграции 067. */
function fakeDb(rows: Array<{ counts_seat: boolean }>, hasColumn = true): SupabaseClient {
  const query = () => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return q;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if ("counts_seat" in filters && !hasColumn) {
          return resolve({ count: null, error: { message: "column club_signups.counts_seat does not exist" } });
        }
        const n = rows.filter((r) => !("counts_seat" in filters) || r.counts_seat === filters.counts_seat).length;
        return resolve({ count: n, error: null });
      },
    };
    return q;
  };
  return { from: () => query() } as unknown as SupabaseClient;
}

describe("countPaidSeats", () => {
  const session = SESSIONS[0];
  const rows = [{ counts_seat: true }, { counts_seat: false }, { counts_seat: true }];

  it("оплата с counts_seat=false коврик не занимает", async () => {
    expect(await countPaidSeats(fakeDb(rows), session)).toBe(2);
  });
  it("до миграции 067 считает все оплаченные, а не закрывает продажу", async () => {
    expect(await countPaidSeats(fakeDb(rows, false), session)).toBe(3);
  });
});

describe("seatsLeftToShow", () => {
  const session = SESSIONS[0];

  it("пока мест больше 5 — число не показываем", () => {
    expect(seatsLeftToShow(0, session)).toBeNull();
    expect(seatsLeftToShow(10, session)).toBeNull();
  });
  it("от 5 до 1 — показываем остаток", () => {
    expect(seatsLeftToShow(11, session)).toBe(5);
    expect(seatsLeftToShow(15, session)).toBe(1);
  });
  it("распродано или посчитать не смогли — null", () => {
    expect(seatsLeftToShow(16, session)).toBeNull();
    expect(seatsLeftToShow(Number.POSITIVE_INFINITY, session)).toBeNull();
  });
});
