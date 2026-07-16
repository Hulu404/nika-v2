import { describe, it, expect } from "vitest";
import { buildMoodChart, buildSprintMoodChart } from "@/lib/analytics";
import type { RunRow } from "@/types/database";

function run(date: string, intensity: RunRow["intensity"] = "easy"): RunRow {
  return {
    id: date,
    user_id: "u",
    date,
    distance_km: 5,
    duration_min: 30,
    intensity,
    note: null,
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
  };
}

// Фиксированное «сегодня», чтобы тесты не зависели от реальной даты.
const NOW = new Date("2026-07-16T12:00:00");

describe("buildMoodChart", () => {
  it("всегда отдаёт ровно 14 дней", () => {
    expect(buildMoodChart([], NOW)).toHaveLength(14);
  });
});

describe("buildSprintMoodChart", () => {
  it("окно = число дней с начала спринта до сегодня включительно", () => {
    // старт 2026-07-10, сегодня 2026-07-16 → 7 дней
    expect(buildSprintMoodChart([], "2026-07-10", NOW)).toHaveLength(7);
  });

  it("день старта = сегодня → 1 день", () => {
    expect(buildSprintMoodChart([], "2026-07-16", NOW)).toHaveLength(1);
  });

  it("не выходит за 21 день даже если спринт длиннее", () => {
    // старт на 40 дней раньше
    expect(buildSprintMoodChart([], "2026-06-06", NOW)).toHaveLength(21);
  });

  it("проставляет интенсивность в нужный день окна", () => {
    const days = buildSprintMoodChart([run("2026-07-16", "hard")], "2026-07-14", NOW);
    expect(days.at(-1)?.intensity).toBe("hard");
    expect(days[0].intensity).toBeNull();
  });
});
