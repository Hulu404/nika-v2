/**
 * Разбор промежутка времени, который человек пишет сам: «с 19 до 21»,
 * «19–21», «после 19», «вечером». Правила — docs/club-survey.md, раздел
 * «Разбор времени». Чистая функция: ни базы, ни часов.
 *
 * Как читаем часы:
 *   • «утра» / «утром» оставляет час утренним, «дня» / «днём» и «вечера» /
 *     «вечером» переводят в вторую половину дня. Слово относится к числу перед
 *     ним и к числам левее без своего слова: «с 7 до 9 вечера» — оба вечерние,
 *     «с 5 утра до 6» — утреннее только 5;
 *   • без слова часы 1–6 читаем как вечерние (+12): занятий в 3 ночи не бывает.
 *     Если так ушло в вечер начало, конец без своего слова тоже вечерний:
 *     «с 6 до 8» — 18:00–20:00.
 */

export type TimeRangeError = "unparsed" | "order" | "short" | "out_of_bounds";

export type TimeRangeResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: TimeRangeError };

export interface TimeRangeOptions {
  /** Длительность занятия, минуты: «в 19» = 19:00 + столько же, промежуток короче — short. */
  sessionMinutes: number;
  /** Границы дня, HH:MM. */
  dayFrom: string;
  dayTo: string;
}

/** «после 19» — столько минут от начала (19:00–22:00), но не дальше конца дня. */
const AFTER_SPAN_MIN = 180;

/** Пресеты словами, без чисел. */
const PRESETS: Readonly<Record<string, [string, string]>> = {
  утром: ["08:00", "11:00"],
  днем: ["12:00", "16:00"],
  вечером: ["18:00", "22:00"],
};

type Meridiem = "am" | "day" | "pm";

const MERIDIEM_WORDS: Readonly<Record<string, Meridiem>> = {
  утра: "am",
  утром: "am",
  дня: "day",
  днем: "day",
  вечера: "pm",
  вечером: "pm",
};

/** Токен: число (час и минуты) или слово. */
type Token = { kind: "num"; hour: number; minute: number } | { kind: "word"; word: string };

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function tokenize(raw: string): Token[] | null {
  const text = raw
    .toLowerCase()
    .replace(/ё/g, "е")
    // Тире любой длины и минус — разделитель промежутка, как пробел.
    .replace(/[-‐‑‒–—−]/g, " ");

  const tokens: Token[] = [];
  const re = /(\d+)(?:[:.](\d+))?|([а-я]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] !== undefined) {
      // «1900», «19:5», «28.10» — не время: часы до двух цифр, минуты ровно две.
      if (m[1].length > 2 || (m[2] !== undefined && m[2].length !== 2)) return null;
      const hour = Number(m[1]);
      const minute = m[2] === undefined ? 0 : Number(m[2]);
      if (hour > 23 || minute > 59) return null;
      tokens.push({ kind: "num", hour, minute });
    } else if (m[3] !== undefined) {
      tokens.push({ kind: "word", word: m[3] });
    }
    // Прочие знаки (запятые, скобки, латиница) пропускаем.
  }
  return tokens;
}

/** Число в минуты с учётом слова «утра/дня/вечера» и правила 1–6 → вечер. */
function resolveHour(hour: number, minute: number, meridiem: Meridiem | null): number {
  let h = hour;
  if (meridiem === "pm" && h < 12) h += 12;
  else if (meridiem === "day" && h <= 6) h += 12;
  else if (meridiem === null && h >= 1 && h <= 6) h += 12;
  return h * 60 + minute;
}

/** Минуты каждого числа: слово времени суток действует на своё число и на числа левее без слова. */
function resolveNumbers(tokens: Token[]): number[] {
  const nums: { hour: number; minute: number; meridiem: Meridiem | null }[] = [];
  for (const t of tokens) {
    if (t.kind === "num") {
      nums.push({ hour: t.hour, minute: t.minute, meridiem: null });
      continue;
    }
    const meridiem = MERIDIEM_WORDS[t.word];
    if (!meridiem) continue;
    for (let i = nums.length - 1; i >= 0 && nums[i].meridiem === null; i--) {
      nums[i] = { ...nums[i], meridiem };
    }
  }
  const minutes = nums.map((n) => resolveHour(n.hour, n.minute, n.meridiem));

  // «с 6 до 8»: начало ушло в вечер по правилу 1–6, значит и конец без своего
  // слова вечерний — иначе вышло бы 18:00–08:00.
  if (nums.length === 2) {
    const [a, b] = nums;
    const startAutoPm = a.meridiem === null && a.hour >= 1 && a.hour <= 6;
    if (startAutoPm && b.meridiem === null && b.hour < 12 && minutes[1] <= minutes[0]) {
      minutes[1] += 12 * 60;
    }
  }
  return minutes;
}

function hasWord(tokens: Token[], word: string): boolean {
  return tokens.some((t) => t.kind === "word" && t.word === word);
}

/** Промежуток в минутах или null, если форма не узнана. */
function rangeMinutes(tokens: Token[], opts: TimeRangeOptions): [number, number] | null {
  const minutes = resolveNumbers(tokens);
  const dayFrom = toMinutes(opts.dayFrom);
  const dayTo = toMinutes(opts.dayTo);

  if (minutes.length === 0) {
    const words = tokens.filter((t) => t.kind === "word").map((t) => (t as { word: string }).word);
    const presets = words.filter((w) => PRESETS[w]);
    if (presets.length !== 1) return null;
    const [from, to] = PRESETS[presets[0]];
    return [toMinutes(from), toMinutes(to)];
  }

  if (minutes.length === 1) {
    const t = minutes[0];
    if (hasWord(tokens, "после") || (hasWord(tokens, "с") && !hasWord(tokens, "до"))) {
      return [t, Math.min(t + AFTER_SPAN_MIN, dayTo)];
    }
    if (hasWord(tokens, "до")) return [dayFrom, t];
    // «в 19», «к 19» и просто «19» — начало занятия.
    return [t, t + opts.sessionMinutes];
  }

  if (minutes.length === 2) return [minutes[0], minutes[1]];
  return null;
}

/**
 * Разобрать промежуток. Ошибки проверяем в таком порядке: форма не узнана →
 * конец не позже начала → выход за границы дня → короче занятия.
 */
export function parseTimeRange(raw: string, opts: TimeRangeOptions): TimeRangeResult {
  const tokens = tokenize(raw.trim());
  if (!tokens || tokens.length === 0) return { ok: false, error: "unparsed" };

  const range = rangeMinutes(tokens, opts);
  if (!range) return { ok: false, error: "unparsed" };

  const [from, to] = range;
  if (to <= from) return { ok: false, error: "order" };
  if (from < toMinutes(opts.dayFrom) || to > toMinutes(opts.dayTo)) {
    return { ok: false, error: "out_of_bounds" };
  }
  if (to - from < opts.sessionMinutes) return { ok: false, error: "short" };

  return { ok: true, from: fromMinutes(from), to: fromMinutes(to) };
}
