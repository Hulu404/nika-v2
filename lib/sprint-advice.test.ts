import { describe, it, expect } from "vitest";
import {
  detectGoalKind,
  buildSprintSignals,
  selectTipThemes,
  fallbackTip,
  type SprintSignals,
} from "@/lib/sprint-advice";
import type { Sprint, RunIntensity } from "@/types/app";
import type { RunRow } from "@/types/database";
import type { SprintTipTheme } from "@/types/app";

function run(date: string, intensity: RunIntensity): RunRow {
  return {
    id: date, user_id: "u", date, distance_km: 5, duration_min: 30,
    intensity, note: null, created_at: `${date}T00:00:00Z`, updated_at: `${date}T00:00:00Z`,
  };
}

function sprint(goal = "цель", startDate = "2026-07-10"): Sprint {
  return {
    id: "s1", user_id: "u", archetype_id: "builder", goal_text: goal,
    milestones_enabled: false, milestones: [], weekly_focus: [], quiz_answers: [],
    closing_reflection: null, start_date: startDate, status: "active",
    closed_at: null, created_at: `${startDate}T00:00:00Z`, updated_at: `${startDate}T00:00:00Z`,
  };
}

const NOW = new Date("2026-07-16T12:00:00"); // день 7, неделя 1

// Базовые сигналы, спокойный сценарий (переопределяем нужные поля в тестах).
function baseSignals(over: Partial<SprintSignals> = {}): SprintSignals {
  return {
    day: 5, week: 1, daysLeft: 16, goalText: "цель", goalKind: "none",
    focus: "фокус", milestonesEnabled: false, milestonesTotal: 0, milestonesAchieved: 0,
    totalRuns: 3, runsThisWeek: 2, hardThisWeek: 0, skippedThisWeek: 0,
    leadingMisses: 0, lastRunDaysAgo: 0, topWords: [], emotionalWord: null,
    energyHint: null, ...over,
  };
}

describe("detectGoalKind", () => {
  it("темп → pace", () => expect(detectGoalKind("Улучшить темп на 20 секунд/км")).toBe("pace"));
  it("дистанция → distance", () => expect(detectGoalKind("Пробежать 15 км без остановки")).toBe("distance"));
  it("забег → distance", () => expect(detectGoalKind("Подготовиться к дистанции забега")).toBe("distance"));
  it("нейтральная → none", () => expect(detectGoalKind("Просто не бросить")).toBe("none"));
});

describe("buildSprintSignals", () => {
  it("считает пропуски подряд от сегодня назад", () => {
    // Пробежка была на день 5 (14 июля), дни 6 и 7 пустые → 2 пропуска подряд.
    const s = buildSprintSignals(sprint(), [run("2026-07-14", "easy")], [], null, NOW);
    expect(s.day).toBe(7);
    expect(s.leadingMisses).toBe(2);
    expect(s.lastRunDaysAgo).toBe(2);
    expect(s.totalRuns).toBe(1);
  });

  it("сегодняшняя пробежка → 0 пропусков", () => {
    const s = buildSprintSignals(sprint(), [run("2026-07-16", "medium")], [], null, NOW);
    expect(s.leadingMisses).toBe(0);
    expect(s.lastRunDaysAgo).toBe(0);
  });

  it("без пробежек → пропуски = прошедшим дням, lastRunDaysAgo=null", () => {
    const s = buildSprintSignals(sprint(), [], [], null, NOW);
    expect(s.leadingMisses).toBe(7);
    expect(s.lastRunDaysAgo).toBeNull();
  });

  it("тип цели прокидывается", () => {
    const s = buildSprintSignals(sprint("Улучшить темп"), [], [], null, NOW);
    expect(s.goalKind).toBe("pace");
  });
});

describe("selectTipThemes", () => {
  it("всегда 2-3 разные темы", () => {
    const themes = selectTipThemes(baseSignals());
    expect(themes.length).toBeGreaterThanOrEqual(2);
    expect(themes.length).toBeLessThanOrEqual(3);
    expect(new Set(themes).size).toBe(themes.length);
  });

  it("недавние пропуски → return_after_break первым", () => {
    const themes = selectTipThemes(baseSignals({ leadingMisses: 3, runsThisWeek: 0 }));
    expect(themes[0]).toBe("return_after_break");
  });

  it("эмоция из чата → emotional", () => {
    expect(selectTipThemes(baseSignals({ emotionalWord: "усталость" }))).toContain("emotional");
  });

  it("много тяжёлых → recovery", () => {
    expect(selectTipThemes(baseSignals({ runsThisWeek: 4, hardThisWeek: 3 }))).toContain("recovery");
  });

  it("низкая энергия при активности → recovery (цикл как скрытый сигнал)", () => {
    expect(selectTipThemes(baseSignals({ runsThisWeek: 2, energyHint: "low" }))).toContain("recovery");
  });

  it("нет выходов на неделе → consistency", () => {
    expect(selectTipThemes(baseSignals({ runsThisWeek: 0, day: 4, leadingMisses: 1 }))).toContain("consistency");
  });

  it("цель про темп → pace_reading", () => {
    expect(selectTipThemes(baseSignals({ goalKind: "pace" }))).toContain("pace_reading");
  });

  it("цель про дистанцию → distance_plan", () => {
    expect(selectTipThemes(baseSignals({ goalKind: "distance" }))).toContain("distance_plan");
  });

  it("ориентиры отстают → milestone_focus", () => {
    const themes = selectTipThemes(
      baseSignals({ milestonesEnabled: true, milestonesTotal: 10, milestonesAchieved: 0, day: 14 }),
    );
    expect(themes).toContain("milestone_focus");
  });

  it("спокойный сценарий содержит keep_going как якорь", () => {
    expect(selectTipThemes(baseSignals())).toContain("keep_going");
  });
});

describe("фолбэк-тексты не раскрывают цикл (152-ФЗ)", () => {
  const ALL: SprintTipTheme[] = [
    "return_after_break", "emotional", "recovery", "consistency",
    "pace_reading", "distance_plan", "milestone_focus", "keep_going",
  ];
  const banned = /цикл|фаз|месяч|менстру|гормон|овуляц/i;

  it("ни один фолбэк не упоминает цикл/фазу", () => {
    const s = baseSignals({ emotionalWord: "усталость", leadingMisses: 3, goalText: "Пробежать 15 км", milestonesTotal: 5, milestonesAchieved: 1 });
    for (const theme of ALL) {
      expect(fallbackTip(theme, s), theme).not.toMatch(banned);
    }
  });

  it("фолбэки без тире в начале предложений", () => {
    const s = baseSignals();
    for (const theme of ALL) {
      expect(fallbackTip(theme, s).trimStart().startsWith("—"), theme).toBe(false);
    }
  });
});
