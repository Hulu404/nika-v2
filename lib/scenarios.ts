import type { Scenario } from "@/types/conversation";

/** Порядок показа сценариев в интерфейсе. */
export const SCENARIO_ORDER: Scenario[] = [
  "morning",
  "after_run",
  "after_skip",
  "pre_race",
  "after_failure",
];

/**
 * Лёгкие метаданные сценариев для UI (без системных промптов).
 * Безопасно импортировать в клиентских компонентах.
 */
export const SCENARIO_META: Record<
  Scenario,
  { title: string; subtitle: string; featured?: boolean }
> = {
  morning: {
    title: "Утро перед бегом",
    subtitle: "Когда тяжело выйти",
  },
  after_run: {
    title: "После пробежки",
    subtitle: "Прожить и закрепить",
  },
  after_skip: {
    title: "После пропуска",
    subtitle: "Когда сорвался с плана",
    featured: true,
  },
  pre_race: {
    title: "Перед стартом",
    subtitle: "Когда волнуешься",
  },
  after_failure: {
    title: "После неудачи",
    subtitle: "Травма или провал",
  },
};
