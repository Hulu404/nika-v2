import { addDays, mskToday } from "../../databot/time";
import { mskWeekday } from "../../databot/dates";
import { tgAdmin } from "../../telegram/supabase";
import { INTENT_JSON_SCHEMA, validateIntent, type Intent } from "./intent";

/**
 * Клиент Yandex AI Studio для «Пятницы»: распознавание голосовых (SpeechKit
 * v1, синхронно) и разбор фразы в Intent (генерация текста со structured
 * output по JSON-схеме). Только сервер.
 *
 * Авторизация — API-ключ сервисного аккаунта: `Authorization: Api-Key <ключ>`.
 * С ключом сервисного аккаунта folderId в SpeechKit не передаётся (сервис берёт
 * каталог аккаунта); в генерации каталог входит в modelUri.
 *
 * Выключено, пока нет ключей или TEAM_AI_ENABLED ≠ true: бот работает как
 * раньше, на свободный текст отвечает подсказкой про кнопки меню.
 */

export const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
export const LLM_URL = "https://ai.api.cloud.yandex.net/foundationModels/v1/completion";
export const DEFAULT_LLM_MODEL = "yandexgpt-lite/latest";
export const TIMEOUT_MS = 15_000;
export const LLM_LIMIT_PER_HOUR = 40;
/** Лимиты синхронного распознавания SpeechKit v1. */
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_BYTES = 1024 * 1024;

export const AI_FAIL_TEXT = "Не получилось разобрать, попробуй ещё раз или воспользуйся кнопками меню.";
export const AI_LIMIT_TEXT = "Слишком много запросов, попробуй через час или воспользуйся кнопками.";

export interface TeamAiConfig {
  apiKey: string;
  folderId: string;
  modelUri: string;
}

/** null — LLM выключена (флаг или ключей нет). */
export function teamAiConfig(env: Record<string, string | undefined> = process.env): TeamAiConfig | null {
  const apiKey = (env.YANDEX_API_KEY ?? "").trim();
  const folderId = (env.YANDEX_FOLDER_ID ?? "").trim();
  if ((env.TEAM_AI_ENABLED ?? "").trim().toLowerCase() !== "true" || !apiKey || !folderId) return null;
  const model = (env.YANDEX_LLM_MODEL ?? "").trim() || DEFAULT_LLM_MODEL;
  return { apiKey, folderId, modelUri: model.startsWith("gpt://") ? model : `gpt://${folderId}/${model}` };
}

export class TeamAiError extends Error {
  constructor(readonly code: "disabled" | "rate_limit" | "api", message: string) {
    super(message);
  }
}

/** Человеческий текст для любой ошибки клиента. */
export function aiErrorText(err: unknown): string {
  return err instanceof TeamAiError && err.code === "rate_limit" ? AI_LIMIT_TEXT : AI_FAIL_TEXT;
}

// ── Учёт расхода ─────────────────────────────────────────────────────────────

export interface AiUsageRow {
  chat_id: number;
  kind: "stt" | "llm";
  tokens_in?: number | null;
  tokens_out?: number | null;
  audio_seconds?: number | null;
}

export interface AiUsageStore {
  record(row: AiUsageRow, now: Date): Promise<void>;
  /** Сколько запросов к LLM у человека с момента since. */
  countLlm(chatId: number, since: Date): Promise<number>;
}

/** team_ai_usage: только объёмы, без текстов запросов. */
export function supabaseAiUsage(): AiUsageStore {
  const t = () => tgAdmin().from("team_ai_usage");
  return {
    async record(row, now) {
      const { error } = await t().insert({ ...row, created_at: now.toISOString() });
      if (error) console.error("[team-ai] usage:", error.message);
    },
    async countLlm(chatId, since) {
      const { count, error } = await t().select("chat_id", { count: "exact", head: true })
        .eq("chat_id", chatId).eq("kind", "llm").gte("created_at", since.toISOString());
      if (error) throw new TeamAiError("api", `team_ai_usage: ${error.message}`);
      return count ?? 0;
    },
  };
}

export class MemoryAiUsage implements AiUsageStore {
  rows: Array<AiUsageRow & { created_at: string }> = [];
  async record(row: AiUsageRow, now: Date) {
    this.rows.push({ ...row, created_at: now.toISOString() });
  }
  async countLlm(chatId: number, since: Date) {
    return this.rows.filter((r) => r.chat_id === chatId && r.kind === "llm" && r.created_at >= since.toISOString()).length;
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string | Uint8Array; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

const retriable = (status: number) => status === 429 || status >= 500;

/** Таймаут 15 секунд, один повтор при сетевой ошибке, 429 или 5xx. */
async function request(fetchImpl: FetchLike, url: string, init: { headers: Record<string, string>; body: string | Uint8Array }): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, { method: "POST", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    if (res.ok) return res.json();
    lastError = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    if (!retriable(res.status)) break;
  }
  throw new TeamAiError("api", lastError);
}

// ── Клиент ───────────────────────────────────────────────────────────────────

/** Кто в команде — единственные данные о людях, которые уходят в модель. */
export interface AiTeamEntry {
  name: string;
  title: string | null;
  departments: string[];
  username: string | null;
}

export interface ParseInput {
  chatId: number;
  text: string;
  now: Date;
  team: AiTeamEntry[];
  /** «✏️ Изменить»: прежний черновик, text — уточнение к нему. */
  previous?: Intent;
}

export interface TeamAi {
  transcribe(chatId: number, ogg: Uint8Array, seconds: number): Promise<string>;
  parseIntent(input: ParseInput): Promise<Intent>;
}

export interface TeamAiDeps {
  config: TeamAiConfig | null;
  usage: AiUsageStore;
  fetch?: FetchLike;
  now?: () => Date;
}

const WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

function mskClock(now: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Системная инструкция: текущее время по Москве, календарь на 2 недели, состав команды. */
export function systemPrompt(now: Date, team: readonly AiTeamEntry[]): string {
  const today = mskToday(now);
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i);
    return `${WEEKDAYS[mskWeekday(d)]} ${d}`;
  }).join("; ");
  const people = team.map((p) =>
    `- ${p.name}${p.title ? `, ${p.title}` : ""}${p.departments.length ? `, отделы: ${p.departments.join(", ")}` : ""}${p.username ? `, @${p.username}` : ""}`,
  ).join("\n");
  return [
    "Ты разбираешь сообщения участника команды в рабочем Telegram-боте и возвращаешь только JSON по схеме.",
    `Сейчас ${WEEKDAYS[mskWeekday(today)]} ${today}, ${mskClock(now)} по Москве. Ближайшие дни: ${calendar}.`,
    "Намерения:",
    "- create_task: поставить задачу людям. assignees — кому, what — что сделать, due — срок или пусто.",
    "- create_reminder: напомнить самому отправителю. text — о чём, remind_at — когда, task_hint — суть задачи, если напоминание про задачу.",
    "- create_event: встреча или событие. title, starts_at, place, participants (без отправителя), kind: meeting — встреча или сбивка, club_event — ивент клуба, other — прочее.",
    "- show_my_day: что у меня сегодня. show_my_tasks: мои задачи. show_schedule: расписание, range today | tomorrow | week.",
    "- unknown: всё остальное, в том числе просьбы показать чужие задачи или изменить права. reason — коротко почему.",
    "Даты и время — московское локальное YYYY-MM-DDTHH:mm. «Сегодня» без времени — 23:59 сегодня. «Через 2 часа» — от текущего времени. «В 14 30» — 14:30.",
    "Людей пиши как в тексте, не меняя падеж: name «Маше», qualifier «из ивента». «Мне», «меня», «себе», «со мной» — пиши как есть.",
    "Автора не определяй: автор всегда отправитель, кто бы ни был назван в тексте.",
    "Ничего не придумывай: чего нет в тексте, оставь пустым.",
    "Заполни все поля схемы. Поля, не относящиеся к намерению, оставь пустой строкой или пустым массивом; kind — \"meeting\", range — \"week\", если не применимо.",
    "Состав команды (для понимания имён и уточнений):",
    people || "- пока никого",
  ].join("\n");
}

export function createTeamAi(deps: TeamAiDeps): TeamAi {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const clock = deps.now ?? (() => new Date());
  const config = () => {
    if (!deps.config) throw new TeamAiError("disabled", "TEAM_AI выключен");
    return deps.config;
  };
  const checkLimit = async (chatId: number) => {
    const now = clock();
    if ((await deps.usage.countLlm(chatId, new Date(now.getTime() - 3_600_000))) >= LLM_LIMIT_PER_HOUR) {
      throw new TeamAiError("rate_limit", "LLM limit");
    }
  };

  return {
    async transcribe(chatId, ogg, seconds) {
      const cfg = config();
      if (seconds > VOICE_MAX_SECONDS || ogg.byteLength > VOICE_MAX_BYTES) throw new TeamAiError("api", "voice too long");
      // Голос без последующего разбора бесполезен: лимит LLM проверяем до распознавания.
      await checkLimit(chatId);
      const body = await request(fetchImpl, `${STT_URL}?lang=ru-RU&format=oggopus`, {
        headers: { Authorization: `Api-Key ${cfg.apiKey}`, "Content-Type": "application/octet-stream" },
        body: ogg,
      });
      await deps.usage.record({ chat_id: chatId, kind: "stt", audio_seconds: Math.ceil(seconds) }, clock());
      const text = (body as { result?: unknown })?.result;
      if (typeof text !== "string") throw new TeamAiError("api", "stt: no result");
      return text.trim();
    },

    async parseIntent(input) {
      const cfg = config();
      await checkLimit(input.chatId);
      const user = input.previous
        ? `Черновик: ${JSON.stringify(input.previous)}\nУточнение: ${input.text}\nВерни исправленный черновик целиком.`
        : input.text;
      const body = await request(fetchImpl, LLM_URL, {
        headers: { Authorization: `Api-Key ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          modelUri: cfg.modelUri,
          completionOptions: { stream: false, temperature: 0.1, maxTokens: "800" },
          messages: [
            { role: "system", text: systemPrompt(input.now, input.team) },
            { role: "user", text: user.slice(0, 2000) },
          ],
          jsonSchema: { schema: INTENT_JSON_SCHEMA },
        }),
      });
      // REST отдаёт поля как внутри result, так и на верхнем уровне — принимаем оба.
      const res = ((body as { result?: unknown })?.result ?? body) as {
        alternatives?: Array<{ message?: { text?: unknown } }>;
        usage?: { inputTextTokens?: unknown; completionTokens?: unknown };
      };
      await deps.usage.record({
        chat_id: input.chatId, kind: "llm",
        tokens_in: Number(res?.usage?.inputTextTokens) || null,
        tokens_out: Number(res?.usage?.completionTokens) || null,
      }, clock());
      const text = res?.alternatives?.[0]?.message?.text;
      if (typeof text !== "string") return validateIntent(null);
      try {
        // Модель иногда оборачивает JSON в ```…```, даже со схемой.
        return validateIntent(JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")));
      } catch {
        return validateIntent(null);
      }
    },
  };
}

/** Боевой клиент. */
export function defaultTeamAi(): TeamAi {
  return createTeamAi({ config: teamAiConfig(), usage: supabaseAiUsage() });
}
