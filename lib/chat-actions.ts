/**
 * Универсальные chat-действия: инструменты, которые НИКА может вызвать в диалоге
 * помимо save_tip. После исполнения сервер добавляет в стрим action-маркер,
 * фронтенд его парсит и рендерит кликабельный чип под сообщением.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
type RunIntensity = "easy" | "medium" | "hard";

// ── Формат action-маркера ─────────────────────────────────────────────────────
// Добавляется в конец стрима невидимым суффиксом, который фронтенд парсит
// и убирает из отображаемого текста.
export interface ChatAction {
  href: string;
  label: string;
}

const ACTION_PREFIX = "\n⟪ACTION:";
const ACTION_SUFFIX = "⟫";

export function encodeAction(action: ChatAction): string {
  return `${ACTION_PREFIX}${JSON.stringify(action)}${ACTION_SUFFIX}`;
}

// Регулярное выражение — строго в конце строки.
const ACTION_RE = /\n⟪ACTION:(\{.*?\})⟫$/;

export function parseAction(text: string): { text: string; action: ChatAction | null } {
  const m = ACTION_RE.exec(text);
  if (!m) return { text, action: null };
  try {
    const action = JSON.parse(m[1]) as ChatAction;
    return { text: text.replace(ACTION_RE, ""), action };
  } catch {
    return { text, action: null };
  }
}

// ── log_run ───────────────────────────────────────────────────────────────────

export const LOG_RUN_TOOL: Anthropic.Tool = {
  name: "log_run",
  description:
    "Записать пробежку пользователя в журнал тренировок. Вызывать только когда пользователь явно рассказал о пробежке с конкретными данными (дистанция или время).",
  input_schema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Дата пробежки в формате YYYY-MM-DD. Если пользователь говорит «сегодня» — использовать сегодняшнюю дату.",
      },
      distance_km: {
        type: "number",
        description: "Дистанция в километрах.",
      },
      duration_min: {
        type: "number",
        description: "Время в минутах. Если неизвестно — не передавать.",
      },
      intensity: {
        type: "string",
        enum: ["easy", "medium", "hard"],
        description: "Интенсивность: easy (лёгкая), medium (средняя), hard (тяжёлая).",
      },
      note: {
        type: "string",
        description: "Короткая заметка о пробежке, 1 предложение, в голосе пользователя.",
      },
    },
    required: ["date", "distance_km", "intensity"],
  },
};

export async function executeLogRun(
  supabase: Client,
  userId: string | null,
  input: unknown,
): Promise<{ ok: boolean; modelMessage: string }> {
  if (!userId) {
    return { ok: false, modelMessage: "Нет аккаунта — не смогла записать пробежку." };
  }

  if (typeof input !== "object" || input === null) {
    return { ok: false, modelMessage: "Некорректные данные пробежки." };
  }
  const raw = input as Record<string, unknown>;
  const date = typeof raw.date === "string" ? raw.date : new Date().toLocaleDateString("en-CA");
  const distance_km = typeof raw.distance_km === "number" ? raw.distance_km : null;
  const intensity = ["easy", "medium", "hard"].includes(raw.intensity as string)
    ? (raw.intensity as RunIntensity)
    : "easy";
  const duration_min = typeof raw.duration_min === "number" ? Math.round(raw.duration_min) : 0;
  const note = typeof raw.note === "string" ? raw.note.trim() : null;

  if (!distance_km || distance_km <= 0) {
    return { ok: false, modelMessage: "Дистанция пробежки не указана или некорректна." };
  }

  const { error } = await supabase.from("runs").insert({
    user_id: userId,
    date,
    distance_km,
    duration_min,
    intensity,
    ...(note ? { note } : {}),
  });

  if (error) {
    console.error("[log_run] insert failed:", error);
    return { ok: false, modelMessage: "Техническая ошибка при записи пробежки." };
  }

  return {
    ok: true,
    modelMessage: "Пробежка записана в журнал. Можешь коротко упомянуть это в ответе.",
  };
}
