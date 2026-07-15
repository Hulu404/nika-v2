import type { Scenario } from "@/types/conversation";

/** Основные 5 сценариев (показываются в навигации/аналитике). */
export const SCENARIO_ORDER: Scenario[] = [
  "morning",
  "after_run",
  "after_skip",
  "pre_race",
  "after_failure",
];

/** Все допустимые сценарии (включая general). */
export const ALL_SCENARIOS: Scenario[] = [...SCENARIO_ORDER, "general"];

interface ScenarioMeta {
  title: string;
  subtitle: string;
  opener: string;
  featured?: boolean;
  /** Быстрые ответы — показываются чипами под последним сообщением НИКИ */
  suggestions: string[];
}

/**
 * Открывающее сообщение НИКИ с учётом реального времени суток.
 * Для сценария «morning» заменяем приветствие на актуальное.
 * Для нового пустого чата (general) даём короткое нейтральное приглашение.
 */
export function timeAwareOpener(scenario: Scenario, hour: number): string {
  if (scenario === "morning") {
    const meta = SCENARIO_META.morning;
    const tail = " Не будем торопиться — давай сначала просто поймём, как ты сейчас. Хочется выйти или внутри сопротивление?";
    if (hour >= 17) return "Добрый вечер." + tail;
    if (hour >= 12) return "Добрый день." + tail;
    return meta.opener;
  }
  return SCENARIO_META[scenario].opener;
}

export const SCENARIO_META: Record<Scenario, ScenarioMeta> = {
  general: {
    title: "Просто поговорить",
    subtitle: "Без темы — просто написать",
    opener: "Привет. Напиши что хочется.",
    suggestions: [
      "Просто хочу поговорить",
      "Как дела с бегом",
      "Есть кое-что на душе",
      "Ничего особенного",
    ],
  },
  morning: {
    title: "Утро перед бегом",
    subtitle: "Когда тяжело выйти",
    opener: "Доброе утро. Не будем торопиться — давай сначала просто поймём, как ты сейчас. Хочется выйти или внутри сопротивление?",
    suggestions: [
      "Не хочется бежать сегодня",
      "Расскажу как было",
      "Пропустил вчера",
      "Просто поговорим",
    ],
  },
  after_run: {
    title: "После пробежки",
    subtitle: "Прожить и закрепить",
    opener: "Ты вернулся. Как ты сейчас — что в теле и в голове?",
    suggestions: [
      "Было хорошо",
      "Тяжело далось",
      "Не добежал до конца",
      "Хочу поделиться",
    ],
  },
  after_skip: {
    title: "После пропуска",
    subtitle: "Когда сорвался с плана",
    opener: "Привет. Ты пропустил — и всё равно пришёл сюда. Это уже бережно по отношению к себе. Расскажешь, что случилось?",
    featured: true,
    suggestions: [
      "Попробую завтра",
      "Боюсь снова бросить",
      "Просто всё навалилось",
      "А если снова не выйду?",
    ],
  },
  pre_race: {
    title: "Перед стартом",
    subtitle: "Когда волнуешься",
    opener: "Скоро старт. Чувствуешь волнение? Давай немного побудем с этим вместе.",
    suggestions: [
      "Очень волнуюсь",
      "Боюсь не добежать",
      "Просто поддержи меня",
      "Что мне сейчас делать?",
    ],
  },
  after_failure: {
    title: "После неудачи",
    subtitle: "Травма или провал",
    opener: "Я рядом. Похоже, было тяжело. Расскажешь, что произошло?",
    suggestions: [
      "Сорвался совсем",
      "Травма",
      "Просто хочу поговорить",
      "Не знаю что делать",
    ],
  },
};
