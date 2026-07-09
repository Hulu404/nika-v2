// Контент и ветвление чат-онбординга. Копирайт — дословно из эталонного
// прототипа docs/prototypes/nika-onboarding-hybrid.html. Логика сохранения в
// БД и финал подключаются отдельными шагами.

export type StepId = "intro" | "name" | "gender" | "cycle" | "proactive" | "final";

/** Род (локально для онбординга; в БД пока male|female — 'neutral' добавим с сохранением). */
export type OnbGender = "female" | "male" | "neutral";
export type OnbCycle = "on" | "self" | "off";
export type OnbProactive = "yes" | "no";

export interface Answers {
  name: string;
  gender: OnbGender | "";
  cycle: OnbCycle | "";
  proactive: OnbProactive | "";
}

export interface Chip {
  label: string;
  value: string;
}

export interface StepDef {
  /** Реплики Ники для этого шага. */
  nika: string[];
  /** Индекс точки прогресса (0..2). У intro/final нет. */
  dot?: 0 | 1 | 2;
  /** Поле состояния, которое собирает шаг. */
  field?: keyof Answers;
  /** Шаг можно пропустить. */
  optional?: boolean;
  /** Подпись под вариантами (cycle). */
  note?: string;
  /** Текстовый ввод (name). */
  input?: { placeholder: string; minLen: number };
  /** Кнопки-варианты. */
  chips?: Chip[];
  /** Реплика-подтверждение на ответ пользователя. */
  ack: (value: string) => string;
}

/** Шаги с контентом (без intro-стартового экрана без данных — intro тоже здесь, но без field). */
export const STEP: Record<Exclude<StepId, "final">, StepDef> = {
  intro: {
    nika: [
      "Привет. Я Ника.",
      "Не тренер и не план тренировок. Просто рядом, чтобы бег не закончился на первой трудной неделе.",
      "Задам пару коротких вопросов. Хочу понять, как говорить именно с тобой.",
    ],
    ack: () => "",
  },
  name: {
    field: "name",
    dot: 0,
    nika: ["Как тебя зовут? Или как хочешь, чтобы я тебя называла."],
    input: { placeholder: "Имя", minLen: 2 },
    ack: (v) => `${v}. Очень приятно.`,
  },
  gender: {
    field: "gender",
    dot: 1,
    nika: [
      "Хочу обращаться к тебе правильно.",
      "Тебе писать „молодец, что вышла“ или „что вышел“?",
    ],
    chips: [
      { label: "вышла", value: "female" },
      { label: "вышел", value: "male" },
      { label: "без разницы", value: "neutral" },
    ],
    ack: () => "Поняла, запомнила.",
  },
  cycle: {
    field: "cycle",
    dot: 1,
    optional: true,
    nika: [
      "И ещё одно, если захочешь ответить.",
      "Бывают дни, когда бежать тяжелее обычного. Часто это цикл, а не то, что ты „разленилась“. Хочешь, буду это учитывать. В такие дни не стану подгонять, дам телу передышку.",
    ],
    note: "Останется между нами. Передумаешь, поменяем в любой момент.",
    chips: [
      { label: "Да, учитывай", value: "on" },
      { label: "Я скажу сама", value: "self" },
      { label: "Лучше не надо", value: "off" },
    ],
    ack: (v) =>
      ({
        on: "Спасибо, что доверилась. В такие дни буду мягче.",
        self: "Хорошо. Просто напиши, когда почувствуешь.",
        off: "Поняла. Не буду об этом заговаривать.",
      })[v] ?? "Хорошо.",
  },
  proactive: {
    field: "proactive",
    dot: 2,
    nika: [
      "И правда последнее. Можно я иногда напишу первой?",
      "Не каждый день и не на ночь глядя. Только если вижу долгий перерыв или впереди что-то важное, например забег.",
    ],
    chips: [
      { label: "Да, пиши", value: "yes" },
      { label: "Лучше я сама", value: "no" },
    ],
    ack: (v) =>
      v === "yes"
        ? "Спасибо. Буду рядом, но без навязчивости."
        : "Поняла. Тогда я жду, когда напишешь сама.",
  },
};

/** Подписи шагов для десктопного степпера. */
export const STEPPER_LABELS = ["Имя", "Обращение", "Сообщения"] as const;

/**
 * Порядок шагов. cycle добавляется ТОЛЬКО при gender==='female'
 * (как в прототипе: next/prev считаются от plan()).
 */
export function plan(a: Answers): StepId[] {
  const p: StepId[] = ["intro", "name", "gender"];
  if (a.gender === "female") p.push("cycle");
  p.push("proactive", "final");
  return p;
}

export function nextOf(id: StepId, a: Answers): StepId | null {
  const p = plan(a);
  return p[p.indexOf(id) + 1] ?? null;
}

export function prevOf(id: StepId, a: Answers): StepId | null {
  const p = plan(a);
  const i = p.indexOf(id);
  return i > 0 ? p[i - 1] : null;
}
