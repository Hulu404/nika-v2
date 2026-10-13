import { tgAdmin } from "../../telegram/supabase";
import { describeNetError, hostOf, isStaleSocket, rememberNetError, yandexFetch } from "./net";

/**
 * Клиент Yandex AI Studio для «Пятницы»: распознавание голосовых (SpeechKit
 * v1, синхронно) и шаг модели с вызовом инструментов (нативный API генерации
 * текста: tools → toolCallList → toolResultList). Только сервер.
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
/** YandexGPT 5 Pro: Lite с вызовом инструментов не справляется. */
export const DEFAULT_LLM_MODEL = "yandexgpt/latest";
export const TIMEOUT_MS = 15_000;
export const LLM_LIMIT_PER_HOUR = 40;
/** Лимиты синхронного распознавания SpeechKit v1. */
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_BYTES = 1024 * 1024;

export const AI_FAIL_TEXT = "Что-то пошло не так, попробуй ещё раз через минуту.";
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

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string | Uint8Array; signal: AbortSignal; fresh?: boolean }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

const retriable = (status: number) => status === 429 || status >= 500;

/** Таймаут 15 секунд, один повтор при сетевой ошибке, 429 или 5xx. */
export const MAX_ATTEMPTS = 3;
/** Пауза перед 2-й и 3-й попыткой. */
export const RETRY_PAUSES_MS = [300, 1200];
/** Меньше этого до дедлайна сообщения — новую попытку не начинаем. */
export const MIN_LEFT_FOR_RETRY_MS = 3_000;

interface RequestOptions {
  /** Момент (Date.now()), после которого не начинать и не ждать. */
  deadline?: number;
  /** Таймаут одного HTTP-запроса. */
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * До 3 попыток: сетевая ошибка, 429 и 5xx — повтор через 300 мс и 1200 мс;
 * оборванное соединение (ECONNRESET, UND_ERR_SOCKET) — первый повтор сразу и
 * на новом соединении. 4xx не повторяется. Повторы — внутри дедлайна сообщения.
 */
async function request(fetchImpl: FetchLike, url: string, init: { headers: Record<string, string>; body: string | Uint8Array }, opts: RequestOptions): Promise<unknown> {
  let lastError = "";
  const host = hostOf(url);
  let fresh = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const left = opts.deadline === undefined ? opts.timeoutMs : Math.min(opts.timeoutMs, opts.deadline - Date.now());
    if (attempt > 1 && opts.deadline !== undefined && opts.deadline - Date.now() < MIN_LEFT_FOR_RETRY_MS) break;
    if (left <= 0) throw new TeamAiError("api", lastError || "deadline");
    let res: Awaited<ReturnType<FetchLike>>;
    const started = Date.now();
    let pause = RETRY_PAUSES_MS[attempt - 1] ?? 0;
    try {
      res = await fetchImpl(url, { method: "POST", ...init, signal: AbortSignal.timeout(left), ...(fresh ? { fresh } : {}) });
    } catch (err) {
      // Настоящая причина «fetch failed» — в err.cause; без неё чинить вслепую.
      const info = describeNetError(err);
      console.error(`[team-ai] net host=${host} attempt=${attempt}/${MAX_ATTEMPTS} after=${Date.now() - started} name=${info.name} code=${info.code ?? "-"} msg=${info.message}`);
      rememberNetError({ at: Date.now(), host, code: info.code ?? info.name });
      lastError = `${info.code ?? info.name}: ${info.message}`;
      fresh = isStaleSocket(info.code);
      if (fresh && attempt === 1) pause = 0;
      if (attempt < MAX_ATTEMPTS && pause) await opts.sleep(pause);
      continue;
    }
    fresh = false;
    if (res.ok) return res.json();
    lastError = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    if (!retriable(res.status)) break;
    if (attempt < MAX_ATTEMPTS) await opts.sleep(pause);
  }
  throw new TeamAiError("api", lastError);
}

// ── Клиент ───────────────────────────────────────────────────────────────────

// ── Вызов инструментов (нативный API генерации текста: tools, toolCallList, toolResultList) ──

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; text: string }
  | { role: "assistant"; toolCallList: { toolCalls: Array<{ functionCall: ToolCall }> } }
  | { role: "user"; toolResultList: { toolResults: Array<{ functionResult: { name: string; content: string } }> } };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type StepResult =
  | { type: "text"; text: string; tokensIn: number; tokensOut: number }
  | { type: "tools"; calls: ToolCall[]; tokensIn: number; tokensOut: number };

export interface StepInput {
  messages: ChatMessage[];
  tools: readonly ToolSpec[];
  /** Момент (Date.now()), после которого запрос не начинать и не ждать. */
  deadline?: number;
}

export interface TeamAi {
  /** Один шаг модели: текстовый ответ или вызовы инструментов. Расход не пишет — это делает вызывающий раз на сообщение. */
  step(input: StepInput): Promise<StepResult>;
  /** Не больше 40 сообщений к модели в час на человека: бросает TeamAiError("rate_limit"). */
  checkLimit(chatId: number): Promise<void>;
  /** Расход одного сообщения (все шаги вместе) — одна строка team_ai_usage. */
  recordLlm(chatId: number, tokensIn: number, tokensOut: number): Promise<void>;
  transcribe(chatId: number, ogg: Uint8Array, seconds: number): Promise<string>;
}

export interface TeamAiDeps {
  config: TeamAiConfig | null;
  usage: AiUsageStore;
  fetch?: FetchLike;
  now?: () => Date;
  /** Пауза между попытками (в тестах — мгновенная). */
  sleep?: (ms: number) => Promise<void>;
}

export function createTeamAi(deps: TeamAiDeps): TeamAi {
  const fetchImpl = deps.fetch ?? (yandexFetch as FetchLike);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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
      }, { timeoutMs: TIMEOUT_MS, sleep });
      await deps.usage.record({ chat_id: chatId, kind: "stt", audio_seconds: Math.ceil(seconds) }, clock());
      const text = (body as { result?: unknown })?.result;
      if (typeof text !== "string") throw new TeamAiError("api", "stt: no result");
      return text.trim();
    },

    checkLimit,

    async recordLlm(chatId, tokensIn, tokensOut) {
      await deps.usage.record({ chat_id: chatId, kind: "llm", tokens_in: tokensIn || null, tokens_out: tokensOut || null }, clock());
    },

    async step(input) {
      const cfg = config();
      const body = await request(fetchImpl, LLM_URL, {
        headers: { Authorization: `Api-Key ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          modelUri: cfg.modelUri,
          completionOptions: { stream: false, temperature: 0.2, maxTokens: "1500" },
          messages: input.messages,
          tools: input.tools.map((t) => ({ function: t })),
        }),
      }, { deadline: input.deadline, timeoutMs: TIMEOUT_MS, sleep });
      const res = ((body as { result?: unknown })?.result ?? body) as {
        alternatives?: Array<{ message?: { text?: unknown; toolCallList?: { toolCalls?: Array<{ functionCall?: { name?: unknown; arguments?: unknown } }> } }; status?: string }>;
        usage?: { inputTextTokens?: unknown; completionTokens?: unknown };
      };
      const tokensIn = Number(res?.usage?.inputTextTokens) || 0;
      const tokensOut = Number(res?.usage?.completionTokens) || 0;
      const message = res?.alternatives?.[0]?.message;
      const calls = (message?.toolCallList?.toolCalls ?? [])
        .map((c) => c.functionCall)
        .filter((f): f is { name: string; arguments: unknown } => typeof f?.name === "string")
        .map((f) => ({ name: f.name, arguments: (f.arguments && typeof f.arguments === "object" ? f.arguments : {}) as Record<string, unknown> }));
      if (calls.length) return { type: "tools", calls, tokensIn, tokensOut };
      if (typeof message?.text === "string") return { type: "text", text: message.text.trim(), tokensIn, tokensOut };
      throw new TeamAiError("api", "llm: empty answer");
    },
  };
}

/** Боевой клиент. */
export function defaultTeamAi(): TeamAi {
  return createTeamAi({ config: teamAiConfig(), usage: supabaseAiUsage() });
}
