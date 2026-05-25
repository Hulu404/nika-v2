import type { Scenario } from "./types";

/** Порядок показа сценариев в меню бота. */
export const SCENARIO_ORDER: Scenario[] = [
  "morning",
  "after_run",
  "after_skip",
  "pre_race",
  "after_failure",
];

interface ScenarioMeta {
  /** Название кнопки в меню. */
  label: string;
  /** Открывающая реплика НИКИ при входе в сценарий. */
  opener: string;
}

export const SCENARIO_META: Record<Scenario, ScenarioMeta> = {
  morning: {
    label: "🌅 Утро перед бегом",
    opener:
      "Доброе утро. Не будем торопиться — давай сначала просто поймём, как ты сейчас. Хочется выйти или внутри сопротивление?",
  },
  after_run: {
    label: "✅ После пробежки",
    opener: "Ты вернулся. Как ты сейчас — что в теле и в голове?",
  },
  after_skip: {
    label: "😔 После пропуска",
    opener:
      "Привет. Ты пропустил — и всё равно пришёл сюда. Это уже бережно по отношению к себе. Расскажешь, что случилось?",
  },
  pre_race: {
    label: "🏁 Перед стартом",
    opener:
      "Скоро старт. Чувствуешь волнение? Давай немного побудем с этим вместе.",
  },
  after_failure: {
    label: "💔 После неудачи",
    opener: "Я рядом. Похоже, было тяжело. Расскажешь, что произошло?",
  },
};

export function isScenario(value: string): value is Scenario {
  return (SCENARIO_ORDER as string[]).includes(value);
}
