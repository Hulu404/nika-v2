/**
 * Конфиг раздела «Советы» (/tips). Только данные, без логики генерации.
 *
 * Тексты взяты из прототипа дословно; длинные тире убраны заменой пунктуации
 * (без изменения слов), диапазоны записаны дефисом. 'all' в CATEGORY_DEFS
 * означает фильтр «показать все», а не категорию совета. personal=true только
 * у id 2 и 7 (бейдж «из твоих разговоров»).
 */

export type TipCategory = "before" | "technique" | "breathing" | "gear" | "recovery";

export interface CategoryDef {
  /** 'all' это фильтр «Все», прочие id это реальные категории советов. */
  id: "all" | TipCategory;
  label: string;
}

export interface Tip {
  id: number;
  category: TipCategory;
  personal: boolean;
  title: string;
  body: string;
}

export const CATEGORY_DEFS: CategoryDef[] = [
  { id: "all", label: "Все" },
  { id: "before", label: "Перед бегом" },
  { id: "technique", label: "Техника" },
  { id: "breathing", label: "Дыхание" },
  { id: "gear", label: "Экипировка" },
  { id: "recovery", label: "Восстановление" },
];

export const TIP_DEFS: Tip[] = [
  {
    id: 1,
    category: "before",
    personal: false,
    title: "Пять минут, и тело поверит",
    body: "Начни с быстрой ходьбы или лёгкой разминки суставов. Первые минуты бега кажутся тяжёлыми не просто так. Телу нужно время поверить, что вы никуда не торопитесь.",
  },
  {
    id: 2,
    category: "before",
    personal: true,
    title: "Обувь важнее плана",
    body: "Проверь шнуровку и стельку перед выходом. Даже лучшая тренировка теряет смысл, если после неё болит колено из-за неудобной обуви.",
  },
  {
    id: 3,
    category: "before",
    personal: false,
    title: "Не бегай на голодный стресс",
    body: "Если день был нервным, не спеши стартовать резко. Пройдись пару минут, подыши, и только потом переходи на бег.",
  },
  {
    id: 4,
    category: "technique",
    personal: false,
    title: "Смотри вперёд, а не под ноги",
    body: "Взгляд на 15-20 метров вперёд сам выравнивает осанку и облегчает дыхание.",
  },
  {
    id: 5,
    category: "technique",
    personal: false,
    title: "Короче шаг, длиннее дистанция",
    body: "Частая, но короткая работа ног бережёт колени лучше, чем широкие прыжки.",
  },
  {
    id: 6,
    category: "technique",
    personal: false,
    title: "Руки работают, а не машут",
    body: "Локти под 90°, движение вперёд-назад, а не поперёк тела. Это экономит силы на вторую половину пробежки.",
  },
  {
    id: 7,
    category: "breathing",
    personal: true,
    title: "Тяжесть в начале пройдёт",
    body: "Первые 10-12 минут дыхание может сбиваться. Это нормально, тело просто перестраивается.",
  },
  {
    id: 8,
    category: "breathing",
    personal: false,
    title: "Считай шаги, а не воздух",
    body: "Попробуй ритм три шага на вдох, два на выдох. Так проще услышать, когда тело просит сбавить темп.",
  },
  {
    id: 9,
    category: "breathing",
    personal: false,
    title: "Дыши животом",
    body: "Глубокое дыхание диафрагмой даёт больше кислорода, чем короткие вдохи грудью.",
  },
  {
    id: 10,
    category: "gear",
    personal: false,
    title: "Слой, который снимаешь",
    body: "Одевайся так, будто на улице теплее на 10 градусов. Через пять минут бега станет жарко.",
  },
  {
    id: 11,
    category: "gear",
    personal: false,
    title: "Носки решают",
    body: "Спортивные носки без грубых швов защищают от мозолей лучше любого крема.",
  },
  {
    id: 12,
    category: "gear",
    personal: false,
    title: "Смени кроссовки вовремя",
    body: "После 600-800 км амортизация стирается, даже если подошва выглядит целой.",
  },
  {
    id: 13,
    category: "recovery",
    personal: false,
    title: "Растяжка: после, не вместо",
    body: "Лёгкая растяжка через 10 минут после финиша работает лучше, чем сразу на месте.",
  },
  {
    id: 14,
    category: "recovery",
    personal: false,
    title: "Вода в первую очередь",
    body: "Восполни воду в течение получаса после пробежки. Восстановление начинается быстрее.",
  },
  {
    id: 15,
    category: "recovery",
    personal: false,
    title: "Сон: часть тренировки",
    body: "Мышцы восстанавливаются не во время бега, а во время сна после него.",
  },
];

/** Подпись категории по id (включая 'all'). */
export function categoryLabel(id: CategoryDef["id"]): string {
  return CATEGORY_DEFS.find((c) => c.id === id)?.label ?? id;
}

/** Группировка советов по категориям (для рендера секциями, если понадобится). */
export function tipsByCategory(): Record<TipCategory, Tip[]> {
  const acc: Record<TipCategory, Tip[]> = {
    before: [],
    technique: [],
    breathing: [],
    gear: [],
    recovery: [],
  };
  for (const tip of TIP_DEFS) acc[tip.category].push(tip);
  return acc;
}
