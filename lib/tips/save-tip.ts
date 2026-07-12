import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TipCategory } from "@/types/app";

/**
 * Серверный инструмент save_tip: НИКА сохраняет короткий персональный совет в
 * раздел «Советы» пользователя (personal_tips). Исполняется только на сервере
 * (chat route), в RLS-контексте текущего юзера.
 */

type Client = SupabaseClient<Database>;

const TIP_CATEGORIES: TipCategory[] = [
  "before",
  "technique",
  "breathing",
  "gear",
  "recovery",
  "mindset",
];

/** Описание инструмента для модели. Description — дословно из спецификации. */
export const SAVE_TIP_TOOL: Anthropic.Tool = {
  name: "save_tip",
  description:
    "Сохранить короткий персональный совет в раздел «Советы» пользователя, когда Ника даёт конкретный совет в ответ на просьбу.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Короткий заголовок совета, 2-5 слов, в голосе Ники, без длинных тире.",
      },
      body: {
        type: "string",
        description:
          "Тело совета, 1-3 предложения, самостоятельная выжимка, читается вне контекста разговора, голос Ники, без планов и чисел-нормативов, без длинных тире.",
      },
      category: {
        type: "string",
        enum: TIP_CATEGORIES,
        description:
          "Категория совета. Для мотивации, тревоги, темы «не бросить», настроя и головы бери mindset.",
      },
      source: {
        type: "string",
        description:
          "Необязательно: очень короткий контекст, например «спросил про боль в колене».",
      },
    },
    required: ["title", "body", "category"],
  },
};

export type SaveTipStatus = "saved" | "duplicate" | "guest" | "invalid";

export interface SaveTipResult {
  status: SaveTipStatus;
  /** Сообщение обратно модели (tool_result), чтобы она корректно отметила исход. */
  modelMessage: string;
}

interface ParsedTip {
  title: string;
  body: string;
  category: TipCategory;
  source: string | null;
}

/**
 * Убираем длинные тире из текста совета: это твёрдый инвариант («без длинных
 * тире внутри save_tip»), а модель инструкцию иногда игнорирует. Диапазоны чисел
 * превращаем в дефис, тире-пунктуацию — в запятую.
 */
export function sanitizeDashes(s: string): string {
  return s
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2") // «15–20» → «15-20»
    .replace(/\s*[—–]\s*/g, ", ") // тире как пунктуация → запятая
    .replace(/\s+([,.;:!?])/g, "$1") // пробел перед знаком препинания
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Нормализация заголовка для дедупа: нижний регистр, схлопнутые пробелы, trim. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Та же нормализация для тела — ловим «тот же совет другими скобками». */
function normalizeBody(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Валидируем и приводим вход инструмента (input у модели типизирован как unknown). */
function parseInput(input: unknown): ParsedTip | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;

  const title = typeof raw.title === "string" ? sanitizeDashes(raw.title) : "";
  const body = typeof raw.body === "string" ? sanitizeDashes(raw.body) : "";
  const category = raw.category;
  const source = typeof raw.source === "string" ? raw.source.trim() : "";

  if (!title || !body) return null;
  if (typeof category !== "string" || !TIP_CATEGORIES.includes(category as TipCategory)) {
    return null;
  }

  return {
    title,
    body,
    category: category as TipCategory,
    source: source || null,
  };
}

/**
 * Исполняет save_tip: валидация → дедуп по нормализованному заголовку/телу →
 * вставка. Возвращает статус и текст для модели. Ошибка записи не бросается —
 * логируется, модель получает «не сохранено».
 */
export async function executeSaveTip(
  supabase: Client,
  userId: string | null,
  input: unknown,
): Promise<SaveTipResult> {
  if (!userId) {
    return {
      status: "guest",
      modelMessage:
        "Не сохранено: у пользователя нет аккаунта (гость). Дай совет словами и не говори, что сохранила.",
    };
  }

  const tip = parseInput(input);
  if (!tip) {
    return {
      status: "invalid",
      modelMessage:
        "Не сохранено: данные совета некорректны. Не говори, что сохранила, просто продолжи разговор.",
    };
  }

  // Дедуп: тянем активные советы юзера и сравниваем нормализованные title/body.
  const { data: existing, error: readErr } = await supabase
    .from("personal_tips")
    .select("title, body")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (readErr) {
    console.error("[save_tip] dedup read failed:", readErr);
    return {
      status: "invalid",
      modelMessage:
        "Не удалось сохранить совет из-за технической ошибки. Не говори, что сохранила.",
    };
  }

  const normTitle = normalizeTitle(tip.title);
  const normBody = normalizeBody(tip.body);
  const dup = (existing ?? []).some(
    (r) => normalizeTitle(r.title) === normTitle || normalizeBody(r.body) === normBody,
  );
  if (dup) {
    return {
      status: "duplicate",
      modelMessage:
        "Такой совет уже есть в «Советах» пользователя. Не отмечай сохранение повторно, просто продолжи разговор.",
    };
  }

  const { error: insertErr } = await supabase.from("personal_tips").insert({
    user_id: userId,
    title: tip.title,
    body: tip.body,
    category: tip.category,
    source: tip.source,
  });

  if (insertErr) {
    console.error("[save_tip] insert failed:", insertErr);
    return {
      status: "invalid",
      modelMessage:
        "Не удалось сохранить совет из-за технической ошибки. Не говори, что сохранила.",
    };
  }

  return {
    status: "saved",
    modelMessage:
      "Сохранено в раздел «Советы» пользователя. Коротко и по-своему отметь это в текущем ответе.",
  };
}
