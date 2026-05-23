import type { Scenario } from "@/types/conversation";

/** Порядок показа сценариев в интерфейсе. */
export const SCENARIO_ORDER: Scenario[] = [
  "morning",
  "after_run",
  "after_skip",
  "pre_race",
  "after_failure",
];

interface ScenarioMeta {
  title: string;
  subtitle: string;
  /** Открывающая реплика НИКИ — показывается сразу при входе в диалог. */
  opener: string;
  featured?: boolean;
}

/**
 * Лёгкие метаданные сценариев для UI (без системных промптов).
 * Безопасно импортировать в клиентских компонентах.
 */
export const SCENARIO_META: Record<Scenario, ScenarioMeta> = {
  morning: {
    title: "Утро перед бегом",
    subtitle: "Когда тяжело выйти",
    opener:
      "Доброе утро. Не будем торопиться — давай сначала просто поймём, как ты сейчас. Хочется выйти или внутри сопротивление?",
  },
  after_run: {
    title: "После пробежки",
    subtitle: "Прожить и закрепить",
    opener: "Ты вернулся. Как ты сейчас — что в теле и в голове?",
  },
  after_skip: {
    title: "После пропуска",
    subtitle: "Когда сорвался с плана",
    opener:
      "Привет. Ты пропустил — и всё равно пришёл сюда. Это уже бережно по отношению к себе. Расскажешь, что случилось?",
    featured: true,
  },
  pre_race: {
    title: "Перед стартом",
    subtitle: "Когда волнуешься",
    opener:
      "Скоро старт. Чувствуешь волнение? Давай немного побудем с этим вместе.",
  },
  after_failure: {
    title: "После неудачи",
    subtitle: "Травма или провал",
    opener: "Я рядом. Похоже, было тяжело. Расскажешь, что произошло?",
  },
};
