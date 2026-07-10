import type { ArchetypeId } from "@/types/app";

export interface ArchetypeOption {
  text: string;
  archetype: ArchetypeId;
}

export interface QuizQuestion {
  text: string;
  options: ArchetypeOption[];
}

export interface ArchetypeDef {
  id: ArchetypeId;
  name: string;
  /** Текст раскрытия архетипа — реплика Ники после квиза. */
  reveal: string;
  /** Вопрос постановки цели. */
  goalQuestion: string;
  /** Готовые варианты цели (3 штуки). */
  goalOptions: string[];
  /** Есть ли шаг ориентиров по умолчанию. */
  structural: boolean;
  /** Вопрос при шаге ориентиров (только для structural). */
  milestoneQuestion?: string;
  /** Тип ввода ориентиров. */
  milestoneType?: "number" | "chips" | "tags";
  /** Значения чипов (только для milestoneType=chips). */
  chips?: number[];
  /** Фокус недели по умолчанию (до первого чек-ина). */
  weeklyFocusDefault: string;
  /** Подсказки-советы (ссылки/темы). */
  tips: string[];
  /** Описание тона наблюдений для системного промпта. */
  observationTone: string;
}

// Копирайт дословно из прототипа, поправлен баг плейсхолдеров цели «Человека с целью».
export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  threshold: {
    id: "threshold",
    name: "На пороге",
    reveal:
      "Ты не притворяешься, что не боишься, и в этом сила. Тебе сейчас важнее не результат, а то, что ты вообще решился(лась) выйти.",
    goalQuestion: "Какая цель на эти три недели по-настоящему твоя?",
    goalOptions: [
      "Просто не бросить",
      "Пробежать 3 раза без отговорок",
      "Дойти до конца хотя бы одной недели полностью",
    ],
    structural: true,
    milestoneQuestion: "Сколько выходов за спринт будет для тебя честной победой?",
    milestoneType: "number",
    weeklyFocusDefault: "Просто выходить, даже когда не по себе.",
    tips: [
      "Что делать, если страшно перед выходом",
      "Как не сравнивать себя с тем, кем был(а) раньше",
    ],
    observationTone: "Признание факта появления, без оценки",
  },
  calm: {
    id: "calm",
    name: "Искатель покоя",
    reveal:
      "Бег для тебя не про километры, а про тишину, которая появляется после. Тебе важно, чтобы в голове стало спокойнее.",
    goalQuestion: "Что должно стать тише за эти три недели?",
    goalOptions: [
      "Бегать, чтобы стало тише в голове",
      "3 спокойные пробежки в неделю, без цели по темпу",
      "Просто выходить, когда шумно внутри",
    ],
    structural: false,
    weeklyFocusDefault: "Бегать без темпа: просто выходить, когда в голове шумно.",
    tips: [
      "Дыхание на бегу, когда в голове много мыслей",
      "Почему медленный бег тоже бег",
    ],
    observationTone: "Открытый чек-ин, без счётчика",
  },
  builder: {
    id: "builder",
    name: "Строитель себя",
    reveal:
      "Ты не боишься трудного: тебе важнее не результат, а то, что ты снова не отступил(а).",
    goalQuestion: "Что мы строим этот спринт?",
    goalOptions: [
      "10 пробежек за 3 недели, что бы ни случилось",
      "Ни одного пропуска больше двух дней подряд",
      "Построить привычку: 3 раза в неделю железно",
    ],
    structural: true,
    milestoneQuestion: "На сколько выходов разобьём цель?",
    milestoneType: "chips",
    chips: [5, 8, 10, 12],
    weeklyFocusDefault: "Держать ритм: не пропускать больше двух дней подряд.",
    tips: [
      "Что делать, если сорвался: план возврата",
      "Привычка сильнее силы воли: как её построить",
    ],
    observationTone: "Дисциплина без вины",
  },
  goal: {
    id: "goal",
    name: "Человек с целью",
    reveal:
      "Ты любишь, когда бег ведёт куда-то конкретно: к цифре, дистанции, финишу. План для тебя не ограничение, а опора.",
    goalQuestion: "Какую цифру берём на этот спринт?",
    goalOptions: [
      "Пробежать 15 км без остановки",
      "Улучшить темп на 20 секунд/км",
      "Подготовиться к дистанции забега",
    ],
    structural: true,
    milestoneQuestion: "Какие отметки по пути важны?",
    milestoneType: "tags",
    weeklyFocusDefault: "Держать план: темп и дистанция важнее настроения.",
    tips: [
      "Как читать свой темп без иллюзий",
      "Расклад дистанции на 3 недели",
    ],
    observationTone: "Конкретика без темп-плана",
  },
  moment: {
    id: "moment",
    name: "Человек момента",
    reveal:
      "Ты бежишь, когда действительно хочешь, а не потому что «надо». Свобода для тебя важнее расписания.",
    goalQuestion: "Что для тебя честная цель, без давления?",
    goalOptions: [
      "Бегать, когда действительно хочется, без графика",
      "Хотя бы 5 пробежек за 3 недели, в любые дни",
      "Не насиловать себя расписанием",
    ],
    structural: false,
    weeklyFocusDefault: "Выходить, когда хочется, без графика и без вины за паузы.",
    tips: [
      "Когда расписание мешает больше, чем помогает",
      "Как услышать «хочу бежать» раньше, чем «надо»",
    ],
    observationTone: "Открытый чек-ин, без счётчика",
  },
};

// Квиз — 4 вопроса, 5 вариантов. Копирайт дословно из прототипа.
export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    text: "Когда представляешь себя через полгода бега, что чувствуешь в первую очередь?",
    options: [
      { text: "Гордость, что не сдался(лась)", archetype: "builder" },
      { text: "Спокойствие, что в голове наконец не так шумно", archetype: "calm" },
      { text: "Что дошёл(шла) до цели, которую ставил(а)", archetype: "goal" },
      { text: "Даже не думаю так далеко, живу от пробежки до пробежки", archetype: "moment" },
      { text: "Честно, ещё не уверен(а), что вообще дойду до этой точки", archetype: "threshold" },
    ],
  },
  {
    text: "Что чаще всего происходит в голове перед пробежкой?",
    options: [
      { text: "Сомнение: а вдруг не смогу", archetype: "threshold" },
      { text: "Шум, куча мыслей, от которых хочется в прямом смысле убежать", archetype: "calm" },
      { text: "План: знаю, что и зачем бегу сегодня", archetype: "goal" },
      { text: "Ничего особенного, просто решаю, хочу сейчас или нет", archetype: "moment" },
      { text: "Внутренний разговор с собой: надо, значит надо", archetype: "builder" },
    ],
  },
  {
    text: "Пропустил(а) тренировку. Что чувствуешь?",
    options: [
      { text: "Вину, будто подвёл(а) себя", archetype: "builder" },
      { text: "Тревогу, что не смогу вернуться", archetype: "threshold" },
      { text: "Расстройство: цель отодвинулась", archetype: "goal" },
      { text: "Ничего страшного, вернусь, когда будет настроение", archetype: "moment" },
      { text: "Если честно, скорее облегчение: видимо, было надо", archetype: "calm" },
    ],
  },
  {
    text: "Какая пробежка для тебя идеальная?",
    options: [
      { text: "Та, после которой в голове тихо", archetype: "calm" },
      { text: "Та, где выполнил(а) план", archetype: "goal" },
      { text: "Та, что далась через силу, но я справился(лась)", archetype: "builder" },
      { text: "Та, на которую вышел(шла) без раздумий", archetype: "moment" },
      { text: "Любая, главное, что вообще вышел(шла)", archetype: "threshold" },
    ],
  },
];

/** Подсчёт архетипа по голосам квиза. При ничье — берём первый в алфавитном порядке. */
export function computeArchetype(votes: ArchetypeId[]): ArchetypeId {
  const counts: Record<string, number> = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  const order: ArchetypeId[] = ["threshold", "calm", "builder", "goal", "moment"];
  return order.reduce((best, id) => (counts[id] ?? 0) > (counts[best] ?? 0) ? id : best, order[0]);
}

/** Плейсхолдер поля ориентиров для архетипа «Человек с целью» зависит от выбранной цели. */
export function goalMilestonePlaceholder(goalText: string): string {
  if (goalText.includes("темп")) return "Например: 6:00/км на 5 км";
  if (goalText.includes("забег")) return "Например: пробежать 10 км за тренировку";
  return "Например: первые 10 км без остановки";
}
