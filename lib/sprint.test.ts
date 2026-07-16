import { describe, it, expect } from "vitest";
import { buildSprintRhythm, buildWeekRecaps, buildSprintSummary } from "@/lib/sprint";
import type { Sprint, RunIntensity, Milestone } from "@/types/app";
import type { RunRow } from "@/types/database";

function run(date: string, intensity: RunIntensity, id = date): RunRow {
  return {
    id,
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

function sprint(startDate: string, milestones: Milestone[] = []): Sprint {
  return {
    id: "s1",
    user_id: "u",
    archetype_id: "builder",
    goal_text: "цель",
    milestones_enabled: milestones.length > 0,
    milestones,
    weekly_focus: [],
    quiz_answers: [],
    closing_reflection: null,
    start_date: startDate,
    status: "active",
    closed_at: null,
    created_at: `${startDate}T00:00:00Z`,
    updated_at: `${startDate}T00:00:00Z`,
  };
}

// Старт 2026-07-10, «сегодня» 2026-07-16 → сегодня = день 7.
const NOW = new Date("2026-07-16T12:00:00");
const START = "2026-07-10";

describe("buildSprintRhythm", () => {
  it("всегда ровно 21 день с корректными dayNumber/week/date", () => {
    const r = buildSprintRhythm(sprint(START), [], NOW);
    expect(r).toHaveLength(21);
    expect(r[0].dayNumber).toBe(1);
    expect(r[0].date).toBe("2026-07-10");
    expect(r[0].week).toBe(1);
    expect(r[7].week).toBe(2); // день 8
    expect(r[14].week).toBe(3); // день 15
    expect(r[20].dayNumber).toBe(21);
    expect(r[20].date).toBe("2026-07-30"); // start + 20
  });

  it("состояния: прошлое / сегодня / будущее", () => {
    const r = buildSprintRhythm(sprint(START), [], NOW);
    expect(r[0].state).toBe("past"); // день 1
    expect(r[6].state).toBe("today"); // день 7 = 2026-07-16
    expect(r[6].date).toBe("2026-07-16");
    expect(r[7].state).toBe("future"); // день 8
    expect(r[20].state).toBe("future");
  });

  it("интенсивность маппится по дате; пропуск → null", () => {
    const runs = [run("2026-07-16", "hard"), run("2026-07-10", "medium")];
    const r = buildSprintRhythm(sprint(START), runs, NOW);
    expect(r[0].intensity).toBe("medium"); // день 1 — есть пробежка
    expect(r[2].intensity).toBeNull(); // день 3 — пропуск
    expect(r[6].intensity).toBe("hard"); // сегодня — есть пробежка
    expect(r[7].intensity).toBeNull(); // будущий день
  });

  it("несколько пробежек за день → берётся первая в массиве", () => {
    const runs = [run("2026-07-10", "easy", "first"), run("2026-07-10", "hard", "second")];
    const r = buildSprintRhythm(sprint(START), runs, NOW);
    expect(r[0].intensity).toBe("easy");
  });
});

describe("buildWeekRecaps", () => {
  it("считает пробежки/тяжёлые/пропуски по неделям и прокидывает topWord", () => {
    const START2 = "2026-06-20"; // весь спринт в прошлом относительно NOW
    const runs = [
      run("2026-06-20", "easy"), // неделя 1
      run("2026-06-22", "hard"), // неделя 1
      run("2026-06-24", "medium"), // неделя 1
      run("2026-06-28", "easy"), // неделя 2
    ];
    const recaps = buildWeekRecaps(buildSprintRhythm(sprint(START2), runs, NOW), "усталость");

    expect(recaps).toHaveLength(3);
    expect(recaps[0]).toMatchObject({ week: 1, runs: 3, hard: 1, skipped: 4, topWord: "усталость" });
    expect(recaps[1]).toMatchObject({ week: 2, runs: 1, hard: 0, skipped: 6 });
  });

  it("будущие дни без пробежки не считаются пропущенными", () => {
    // START=2026-07-10, NOW=2026-07-16 → неделя 1: 6 прошедших + сегодня; недели 2-3 в будущем
    const recaps = buildWeekRecaps(buildSprintRhythm(sprint(START), [], NOW));
    expect(recaps[0].skipped).toBe(6); // дни 1-6 без пробежки; день 7 (сегодня) — не пропуск
    expect(recaps[1].skipped).toBe(0); // неделя 2 — будущее
    expect(recaps[2].skipped).toBe(0); // неделя 3 — будущее
  });
});

describe("buildSprintSummary", () => {
  it("суммирует пробежки, отмеченные ориентиры и топ-3 слова", () => {
    const START2 = "2026-06-20"; // весь спринт в прошлом
    const runs = [
      run("2026-06-20", "easy"), // неделя 1
      run("2026-06-22", "hard"), // неделя 1
      run("2026-06-28", "easy"), // неделя 2
      run("2026-07-05", "medium"), // неделя 3
    ];
    const milestones: Milestone[] = [
      { id: "m1", label: "Пробежать 5 км", achieved_at: "2026-06-25T00:00:00Z" },
      { id: "m2", label: "Не бросить", achieved_at: null },
    ];
    const words = [
      { text: "лень", freq: 9 },
      { text: "усталость", freq: 5 },
      { text: "радость", freq: 3 },
      { text: "дождь", freq: 1 },
    ];
    const summary = buildSprintSummary(
      sprint(START2, milestones),
      buildSprintRhythm(sprint(START2), runs, NOW),
      words,
    );

    expect(summary.totalRuns).toBe(4);
    expect(summary.runsByWeek).toEqual([2, 1, 1]);
    expect(summary.achievedMilestones).toEqual(["Пробежать 5 км"]);
    expect(summary.topWords).toEqual(["лень", "усталость", "радость"]);
  });
});
