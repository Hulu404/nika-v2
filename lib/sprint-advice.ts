import type { RunRow } from "@/types/database";
import type { Sprint, SprintTipTheme } from "@/types/app";
import type { WordFreq } from "@/lib/analytics";
import { tokenize } from "@/lib/analytics";
import { sprintWeek, currentWeeklyFocus, buildSprintRhythm, buildWeekRecaps } from "@/lib/sprint";

/**
 * Гибридные советы спринта: правила выбирают релевантные ТЕМЫ по сигналам
 * пользователя (бег/чат/цель/состояние), LLM формулирует текст живым голосом
 * Ники с реальными цифрами. Этот модуль — детерминированная часть (сигналы +
 * выбор тем + фолбэк-тексты), чтобы её можно было тестировать без сети.
 *
 * ПРИВАТНОСТЬ: фаза цикла входит только как внутренний сигнал энергии
 * (energyHint) и НИКОГДА не называется в теме/тексте (152-ФЗ, спека §6).
 */

export type EnergyHint = "low" | "normal" | "high";
export type GoalKind = "pace" | "distance" | "none";

export interface SprintSignals {
  day: number;
  week: 1 | 2 | 3;
  daysLeft: number;
  goalText: string;
  goalKind: GoalKind;
  focus: string;
  milestonesEnabled: boolean;
  milestonesTotal: number;
  milestonesAchieved: number;
  totalRuns: number;
  runsThisWeek: number;
  hardThisWeek: number;
  skippedThisWeek: number;
  leadingMisses: number; // прошедших дней подряд без пробежки, считая от сегодня назад
  lastRunDaysAgo: number | null; // null — пробежек ещё не было
  topWords: string[];
  emotionalWord: string | null; // сильная эмоция из чата, если встретилась
  energyHint: EnergyHint | null; // ВНУТРЕННИЙ сигнал, в текст не попадает
}

// Эмоциональные маркеры из чата (нормализованные корни). Порядок = приоритет.
const EMOTION_MARKERS: { root: string; label: string }[] = [
  { root: "страх", label: "страшно" },
  { root: "страшн", label: "страшно" },
  { root: "устал", label: "усталость" },
  { root: "вина", label: "вина" },
  { root: "винова", label: "вина" },
  { root: "срыв", label: "срыв" },
  { root: "лен", label: "лень" },
  { root: "тяжел", label: "тяжело" },
  { root: "тяжёл", label: "тяжело" },
  { root: "больно", label: "боль" },
  { root: "хочу", label: "не хочу" },
];

/** Тип цели по ключевым словам (для тем pace/distance). */
export function detectGoalKind(goalText: string): GoalKind {
  const g = goalText.toLowerCase();
  if (/темп|секунд|скорост|быстр/.test(g)) return "pace";
  if (/\bкм\b|киломе|дистанц|забег|10\s*к|15\s*к|21\s*к|марафон/.test(g)) return "distance";
  return "none";
}

/** Ищет первую сильную эмоцию среди слов пользователя (по частотному облаку). */
function findEmotionalWord(words: WordFreq[]): string | null {
  for (const m of EMOTION_MARKERS) {
    if (words.some((w) => w.text.startsWith(m.root))) return m.label;
  }
  return null;
}

/**
 * Собирает сигналы из спринта, пробежек, облака слов и внутреннего сигнала
 * энергии. Чистая функция — считается на сервере и в тестах.
 */
export function buildSprintSignals(
  sprint: Sprint,
  runs: RunRow[],
  words: WordFreq[],
  energyHint: EnergyHint | null,
  now = new Date(),
): SprintSignals {
  // День спринта от переданного now (консистентно с окном ритма ниже).
  const start = new Date(sprint.start_date);
  start.setHours(0, 0, 0, 0);
  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const day = Math.min(Math.floor((today0.getTime() - start.getTime()) / 86_400_000) + 1, 21);
  const week = sprintWeek(day);
  const rhythm = buildSprintRhythm(sprint, runs, now);
  const recaps = buildWeekRecaps(rhythm);
  const thisWeek = recaps.find((r) => r.week === week);

  // Пропуски подряд от сегодня назад (только прошедшие дни без пробежки).
  const past = rhythm.filter((d) => d.state !== "future");
  let leadingMisses = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].intensity === null) leadingMisses++;
    else break;
  }

  // Сколько дней назад была последняя пробежка (по ритму спринта).
  let lastRunDaysAgo: number | null = null;
  const todayIdx = past.length - 1;
  for (let i = todayIdx; i >= 0; i--) {
    if (past[i].intensity !== null) { lastRunDaysAgo = todayIdx - i; break; }
  }

  const totalRuns = rhythm.filter((d) => d.intensity !== null).length;

  return {
    day,
    week,
    daysLeft: 21 - day,
    goalText: sprint.goal_text,
    goalKind: detectGoalKind(sprint.goal_text),
    focus: currentWeeklyFocus(sprint),
    milestonesEnabled: sprint.milestones_enabled,
    milestonesTotal: sprint.milestones.length,
    milestonesAchieved: sprint.milestones.filter((m) => m.achieved_at).length,
    totalRuns,
    runsThisWeek: thisWeek?.runs ?? 0,
    hardThisWeek: thisWeek?.hard ?? 0,
    skippedThisWeek: thisWeek?.skipped ?? 0,
    leadingMisses,
    lastRunDaysAgo,
    topWords: words.slice(0, 3).map((w) => w.text),
    emotionalWord: findEmotionalWord(words),
    energyHint,
  };
}

/**
 * Правила выбора тем по приоритету. Возвращает 2-3 РАЗНЫЕ темы. Всегда есть хотя
 * бы одна (keep_going как якорь). Чистая функция — тестируется.
 */
export function selectTipThemes(s: SprintSignals): SprintTipTheme[] {
  const picked: SprintTipTheme[] = [];
  const add = (t: SprintTipTheme) => {
    if (!picked.includes(t) && picked.length < 3) picked.push(t);
  };

  // 1. Недавно выпал из ритма — вернуть мягко, это важнее всего.
  if (s.leadingMisses >= 2) add("return_after_break");

  // 2. Явная эмоция в чате — встретить там, где человек сейчас.
  if (s.emotionalWord) add("emotional");

  // 3. Перебор с нагрузкой (много тяжёлых) — сбавить. Низкая энергия усиливает.
  const hardHeavy =
    s.hardThisWeek >= 3 || (s.runsThisWeek > 0 && s.hardThisWeek / s.runsThisWeek >= 0.6);
  if (hardHeavy || (s.energyHint === "low" && s.runsThisWeek > 0)) add("recovery");

  // 4. На этой неделе ещё не выходил(а), а время идёт — про «просто выйти».
  if (s.runsThisWeek === 0 && s.leadingMisses < 2 && s.day > 1) add("consistency");

  // 5. Тема под тип цели.
  if (s.goalKind === "pace") add("pace_reading");
  else if (s.goalKind === "distance") add("distance_plan");

  // 6. Ориентиры отстают от прогресса спринта.
  if (s.milestonesEnabled && s.milestonesTotal > 0) {
    const expected = (s.day / 21) * s.milestonesTotal * 0.6; // мягкий ожидаемый темп
    if (s.milestonesAchieved < expected) add("milestone_focus");
  }

  // Добьём до минимум двух якорем к цели/фокусу.
  add("keep_going");
  if (picked.length < 2) add(s.goalKind === "distance" ? "distance_plan" : "consistency");

  return picked.slice(0, 3);
}

/**
 * Фолбэк-тексты (когда LLM недоступен). Голос Ники, без тире и упоминаний цикла.
 * Плейсхолдеры {n} подставляются из сигналов в fallbackTip().
 */
const THEME_FALLBACK: Record<SprintTipTheme, (s: SprintSignals) => string> = {
  return_after_break: (s) =>
    `Небольшая пауза в ${s.leadingMisses} ${plural(s.leadingMisses, "день", "дня", "дней")} это не срыв. Выйди сегодня совсем ненадолго, просто чтобы вернуть ритм, без наверстывания.`,
  emotional: (s) =>
    `Ты часто возвращаешься к «${s.emotionalWord}». Пусть ближайший выход будет коротким и бережным, без задачи что-то доказать.`,
  recovery: () =>
    `Несколько тяжёлых подряд, телу нужен выдох. Сделай следующую пробежку совсем лёгкой или дай себе спокойный день, это часть работы.`,
  consistency: () =>
    `На этой неделе выхода ещё не было. Не думай про дистанцию, просто выйди на пятнадцать минут, этого достаточно, чтобы неделя состоялась.`,
  pace_reading: () =>
    `Ты держишь темп в цели. Смотри на него как на подсказку, а не на приговор: ровный комфортный бег иногда полезнее быстрого.`,
  distance_plan: (s) =>
    `Цель «${s.goalText}» ближе, чем кажется. Разложи её на маленькие шаги по неделям и добавляй понемногу, без рывков.`,
  milestone_focus: (s) =>
    `Отмечено ${s.milestonesAchieved} из ${s.milestonesTotal} ориентиров. Выбери один ближайший и держись только его, остальное подтянется.`,
  keep_going: (s) =>
    `Ты на дне ${s.day} из 21. Фокус недели «${s.focus}» уже помогает, просто продолжай в своём темпе.`,
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Фолбэк-совет по теме (без сети). */
export function fallbackTip(theme: SprintTipTheme, s: SprintSignals): string {
  return THEME_FALLBACK[theme](s);
}

// ── Промпт для LLM ─────────────────────────────────────────────────────────────

// Что должен раскрыть каждый совет (интент темы для модели).
const THEME_INTENT: Record<SprintTipTheme, string> = {
  return_after_break: "мягко вернуть в ритм после недавних пропусков, без наверстывания и вины",
  emotional: "отозваться на частую эмоцию из чата, поддержать, предложить бережный маленький шаг",
  recovery: "предложить сбавить нагрузку и восстановиться после нескольких тяжёлых пробежек",
  consistency: "помочь просто выйти на этой неделе, снять планку по дистанции",
  pace_reading: "как относиться к темпу без иллюзий и давления цифры",
  distance_plan: "как разложить дистанционную цель на маленькие шаги по неделям",
  milestone_focus: "сосредоточиться на одном ближайшем ориентире",
  keep_going: "тёплый якорь к цели и фокусу недели, поддержать продолжать",
};

/**
 * Промпт генерации советов. Модель получает сигналы (цифры) и выбранные темы,
 * возвращает по одному совету на тему. Фаза цикла в промпт НЕ передаётся —
 * только обобщённый тон энергии, и модели прямо запрещено называть причину.
 */
export function buildTipsPrompt(s: SprintSignals, themes: SprintTipTheme[], name: string): string {
  const energyLine =
    s.energyHint === "low"
      ? "Сейчас у пользователя скорее меньше сил, чем обычно (внутренний сигнал). Сделай советы мягче по нагрузке. Причину НЕ называй, слова про цикл/фазу/гормоны НЕ используй."
      : s.energyHint === "high"
        ? "Сейчас сил скорее больше обычного — можно чуть амбициознее, но без давления."
        : null;

  const data = [
    `Имя: ${name}`,
    `Форма обращения: женская`,
    `День спринта: ${s.day} из 21 (неделя ${s.week})`,
    `Цель спринта: «${s.goalText}»`,
    `Фокус недели: «${s.focus}»`,
    s.milestonesEnabled ? `Ориентиры: ${s.milestonesAchieved} из ${s.milestonesTotal} отмечено` : null,
    `Пробежек за неделю: ${s.runsThisWeek}, из них тяжёлых: ${s.hardThisWeek}`,
    `Пропущено дней подряд сейчас: ${s.leadingMisses}`,
    s.lastRunDaysAgo !== null ? `Последняя пробежка: ${s.lastRunDaysAgo} дн. назад` : `Пробежек в спринте пока нет`,
    `Всего пробежек за спринт: ${s.totalRuns}`,
    s.topWords.length ? `Частые слова из чата: ${s.topWords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const themeList = themes
    .map((t, i) => `${i + 1}. theme="${t}" — ${THEME_INTENT[t]}`)
    .join("\n");

  return `Ты — Ника, беговой компаньон. Напиши ${themes.length} коротких персональных совета для страницы спринта.

Данные пользователя:
${data}
${energyLine ? `\n${energyLine}\n` : ""}
Темы советов (по одному совету на тему, в этом же порядке):
${themeList}

Ответь строго JSON без markdown:
{"tips":[${themes.map((t) => `{"theme":"${t}","text":"..."}`).join(",")}]}

Требования к тексту:
— Голос Ники: тёплый, конкретный, живой. Без ИИ-клише (без «безусловно», «конечно», «однако», «кроме того», «важно отметить»)
— Каждый совет 1-2 предложения, одно конкретное действие
— Опирайся на реальные цифры пользователя выше, где это уместно
— Без тире в начале предложений и без перечислений через «—»
— Только бег, темп, сон, восстановление, настрой. Никаких медицинских рекомендаций
— НИКОГДА не упоминай цикл, фазу, месячные, гормоны`;
}
