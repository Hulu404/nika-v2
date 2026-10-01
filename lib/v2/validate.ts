/**
 * Проверка входных данных API новой версии (/api/v2/*). Чистые функции без
 * обращения к БД: роуты только вызывают их и пишут результат.
 */
import type { Gender, CyclePref, RunIntensity } from "@/types/app";

export const INTENTS = ["hard", "starts", "return", "listen", "other"] as const;
export const BARRIERS = ["head", "time", "tired", "weather", "fear", "other"] as const;
export const BASELINES = ["rare", "low", "mid", "high"] as const;
export const DAYPARTS = ["morning", "noon", "evening", "varies"] as const;
export const BEHAVIORS = [
  "sleep",
  "run_am",
  "run_together",
  "coffee",
  "ate",
  "heavy_legs",
  "anxious",
  "work",
  "heat",
  "pain",
] as const;
export const UI_FONTS = ["nika", "tikhaya", "kniga", "golos", "pryamaya"] as const;
export const UI_SIZES = [94, 100, 108, 118] as const;
export const UI_SKIES = ["sc-dawn", "sc-dusk", "sc-night", "sc-mist"] as const;

const CUSTOM_MAX = 60;
const NAME_MAX = 40;
export const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v.trim());
}

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Дата клиента допустима, если отличается от UTC-сегодня не больше чем на сутки (часовые пояса). */
export function isPlausibleToday(ymd: string, now = new Date()): boolean {
  if (!isYmd(ymd)) return false;
  const diff = Math.abs(new Date(ymd + "T12:00:00Z").getTime() - now.getTime());
  return diff <= 36 * 3600 * 1000;
}

function pick<T extends readonly string[]>(list: T, v: unknown): T[number] | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : "";
}

/** Метки дневника: коды из BEHAVIORS или свои с префиксом 'c:' (до 60 символов). */
export function cleanTags(v: unknown, max = 12): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    if ((BEHAVIORS as readonly string[]).includes(raw)) out.push(raw);
    else if (raw.startsWith("c:")) {
      const t = cleanText(raw.slice(2), CUSTOM_MAX);
      if (t) out.push("c:" + t);
    }
    if (out.length >= max) break;
  }
  return Array.from(new Set(out));
}

/** Ответ «учитывать цикл» в онбординге → CyclePref профиля. «Позже» значит «не спрашивали». */
export function cycleFromAnswer(v: unknown): CyclePref | null | undefined {
  if (v === "yes") return "on";
  if (v === "no") return "off";
  if (v === "later") return null;
  return undefined;
}

/** Вкладка «Мой ритм»: женский род и явное согласие учитывать цикл ('self' это старый вариант «скажу сама»). */
export function rhythmEnabled(gender: string | null | undefined, cycle: string | null | undefined): boolean {
  return gender === "female" && (cycle === "on" || cycle === "self");
}

export interface ProfilePatch {
  name?: string;
  gender?: Exclude<Gender, "neutral">;
  intent?: string | null;
  intent_custom?: string | null;
  barrier?: string | null;
  barrier_custom?: string | null;
  baseline?: string | null;
  daypart?: string | null;
  behaviors?: string[];
  cycle?: CyclePref | null;
  proactive?: boolean;
  ui_prefs?: Record<string, string | number | boolean>;
}

/**
 * Разбирает тело онбординга или правки профиля. Поля необязательны: присланное
 * и валидное попадает в patch, невалидное даёт ошибку с именем поля.
 */
export function parseProfilePatch(body: Record<string, unknown>): { patch: ProfilePatch; errors: string[] } {
  const patch: ProfilePatch = {};
  const errors: string[] = [];

  if ("name" in body) {
    const n = cleanText(body.name, NAME_MAX);
    if (n === undefined) errors.push("name");
    else patch.name = n;
  }
  if ("gender" in body) {
    if (body.gender === "female" || body.gender === "male") patch.gender = body.gender;
    else errors.push("gender");
  }
  const single: [keyof ProfilePatch, readonly string[]][] = [
    ["intent", INTENTS],
    ["barrier", BARRIERS],
    ["baseline", BASELINES],
    ["daypart", DAYPARTS],
  ];
  for (const [key, list] of single) {
    if (!(key in body)) continue;
    const v = pick(list, body[key]);
    if (v === undefined) errors.push(key);
    else (patch as Record<string, unknown>)[key] = v;
  }
  for (const key of ["intent_custom", "barrier_custom"] as const) {
    const src = key === "intent_custom" ? body.intentCustom : body.barrierCustom;
    if (src === undefined) continue;
    const t = cleanText(src, CUSTOM_MAX);
    if (t === undefined) errors.push(key);
    else patch[key] = t || null;
  }
  if ("behaviors" in body) {
    const tags = cleanTags(body.behaviors, 5);
    if (!tags || tags.length < 3) errors.push("behaviors");
    else patch.behaviors = tags;
  }
  if ("cycle" in body) {
    const c = cycleFromAnswer(body.cycle);
    if (c === undefined) errors.push("cycle");
    else patch.cycle = c;
  }
  if ("proactive" in body) {
    if (typeof body.proactive === "boolean") patch.proactive = body.proactive;
    else errors.push("proactive");
  }
  if ("uiPrefs" in body) {
    const prefs = parseUiPrefs(body.uiPrefs);
    if (!prefs) errors.push("uiPrefs");
    else patch.ui_prefs = prefs;
  }
  return { patch, errors };
}

export function parseUiPrefs(v: unknown): Record<string, string | number | boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  const font = pick(UI_FONTS, src.font);
  if (font) out.font = font;
  if (typeof src.size === "number" && (UI_SIZES as readonly number[]).includes(src.size)) out.size = src.size;
  const sky = pick(UI_SKIES, src.sky);
  if (sky) out.sky = sky;
  if (typeof src.contrast === "boolean") out.contrast = src.contrast;
  if (typeof src.calm === "boolean") out.calm = src.calm;
  return out;
}

export interface RunInput {
  date: string;
  distance_km: number;
  duration_min: number;
  intensity: RunIntensity;
  ratings: Record<string, number> | null;
  tags: string[];
  note: string | null;
}

const RATING_KEYS = ["effort", "legs", "breath", "mood"] as const;

/** Пробежка после бега: дата не в будущем, дистанция 0,1–100 км, время 1–600 минут. */
export function parseRun(body: Record<string, unknown>, now = new Date()): RunInput | null {
  const date = body.date;
  if (!isYmd(date)) return null;
  if (new Date(date + "T00:00:00Z").getTime() > now.getTime() + 36 * 3600 * 1000) return null;
  const km = typeof body.distanceKm === "number" ? body.distanceKm : NaN;
  const min = typeof body.durationMin === "number" ? body.durationMin : NaN;
  if (!(km >= 0.1 && km <= 100) || !(min >= 1 && min <= 600)) return null;

  let ratings: Record<string, number> | null = null;
  if (body.ratings && typeof body.ratings === "object") {
    const src = body.ratings as Record<string, unknown>;
    for (const k of RATING_KEYS) {
      const r = src[k];
      if (typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 10) {
        ratings = ratings ?? {};
        ratings[k] = r;
      }
    }
  }
  const effort = ratings?.effort;
  const intensity: RunIntensity = effort == null || effort <= 4 ? "easy" : effort <= 7 ? "medium" : "hard";
  const note = cleanText(body.note, 1000);
  return {
    date,
    distance_km: Math.round(km * 100) / 100,
    duration_min: Math.round(min),
    intensity,
    ratings,
    tags: cleanTags(body.tags) ?? [],
    note: note || null,
  };
}

/** Запись дневника: текст 1–4000 символов, дата клиента, метки. */
export function parseDiaryEntry(
  body: Record<string, unknown>,
  now = new Date(),
): { text: string; date: string; tags: string[] } | null {
  if (typeof body.text !== "string") return null;
  const text = body.text.trim().slice(0, 4000);
  if (!text) return null;
  const date = isPlausibleToday(body.date as string, now) ? (body.date as string) : now.toISOString().slice(0, 10);
  return { text, date, tags: cleanTags(body.tags) ?? [] };
}

/** Практики с аудио. Остальные в интерфейсе не показываются, пока не появится звук. */
export const PRACTICES = {
  zazemlenie: { title: "Заземление", seconds: 292, audio: "/authv1/audio/nika-zazemlenie.mp3" },
} as const;
export type PracticeId = keyof typeof PRACTICES;

export function isPracticeId(v: unknown): v is PracticeId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PRACTICES, v);
}
