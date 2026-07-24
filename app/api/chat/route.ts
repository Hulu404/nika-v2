import type Anthropic from "@anthropic-ai/sdk";
import { isAuthError, type User } from "@supabase/supabase-js";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";
import { createConversation, getConversation, updateConversation } from "@/lib/conversations";
import { checkDailyLimits } from "@/lib/limits";
import { calculateQuotaUnits, planConfig } from "@/lib/plans/limits-config";
import { countMessageTokens } from "@/lib/tokens";
import { buildSystemPrompt } from "@/lib/prompts";
import { checkRateLimit } from "@/lib/rate-limit";
import { contextWindow } from "@/lib/chat-window";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { buildSprintContext, getActiveSprint } from "@/lib/sprint";
import { getRecentDailyState, parseYmd, userToday } from "@/lib/rhythm";
import { buildRhythmContext } from "@/lib/rhythm/chat-context";
import { getLatestCycles, getTodayCheckin, getCycleLength, getCycleDay, getPhase, buildCycleContext } from "@/lib/rhythm/cycles";
import { getProfile, showRhythm } from "@/lib/profile";
import { SAVE_TIP_TOOL, executeSaveTip } from "@/lib/tips/save-tip";
import { LOG_RUN_TOOL, executeLogRun, encodeAction } from "@/lib/chat-actions";
import { resolveTier } from "@/lib/subscription";
import { createServerComponentClient } from "@/lib/supabase";
import type { Message } from "@/types/app";
import type { Scenario } from "@/types/conversation";

export const runtime = "nodejs";

// ── Ограничения payload ───────────────────────────────────────────────────────
// Абсолютный потолок — защита от абьюза, а НЕ от долгого диалога. Обычную
// переписку он не задевает.
//
// Раньше здесь стояли 50 реплик / 24 000 символов, и превышение отдавало 400.
// Клиент шлёт всю историю каждый раз, а диалог живёт через дни и растёт — так
// что тред, перевалив за 50 реплик, ломался НАВСЕГДА: каждая отправка получала
// молчаливый 400, и пользователю оставалось только начать новый диалог, о чём
// он никак не узнавал. Теперь длинная история обрезается окном ниже.
const MAX_MESSAGES = 400; // реплик в истории за запрос
const MAX_MESSAGE_CHARS = 4_000; // символов в одной реплике
const MAX_TOTAL_CHARS = 200_000; // суммарно по всем репликам

// Сколько истории реально уходит в Claude — см. lib/chat-window.ts.

// ── Rate limit на пользователя ────────────────────────────────────────────────
const CHAT_RATE_LIMIT = 20; // запросов
const CHAT_RATE_WINDOW_SECONDS = 60; // за окно (1 минута)

interface ChatRequest {
  scenario: Scenario;
  messages: { role: "user" | "assistant"; content: string }[];
  conversationId?: string | null;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { scenario, messages, conversationId } = body;

  if (!ALL_SCENARIOS.includes(scenario)) {
    return Response.json({ error: "Unknown scenario" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    console.warn("[api/chat] payload rejected: too many messages", messages.length);
    return Response.json({ error: "Too many messages" }, { status: 400 });
  }

  // Каждая реплика должна быть валидной парой role/content разумного размера.
  let totalChars = 0;
  for (const m of messages) {
    if (
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string"
    ) {
      return Response.json({ error: "Invalid message" }, { status: 400 });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      console.warn("[api/chat] payload rejected: message too long", m.content.length);
      return Response.json({ error: "Message too long" }, { status: 400 });
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    console.warn("[api/chat] payload rejected: conversation too long", totalChars);
    return Response.json({ error: "Conversation too long" }, { status: 400 });
  }

  const supabase = await createServerComponentClient();

  // ── Сессия ──────────────────────────────────────────────────────────────────
  // Ошибки авторизации getUser() отдаёт в поле `error` (refresh_token_not_found
  // приходит именно так), но сорваться может и броском — например если не
  // удалось взять внутренний лок клиента. Обрабатываем оба пути: протухшая
  // сессия — это не 500, фронт должен получить однозначный 401 и предложить
  // войти заново.
  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    user = data.user;
  } catch (err) {
    // Не про авторизацию (сеть, недоступный Supabase) — это честная 500,
    // маскировать её под «войди заново» нельзя.
    if (!isAuthError(err)) throw err;
    // Раньше `error` молча отбрасывался — поэтому refresh_token_not_found и
    // не был виден в логах роута.
    console.warn("[api/chat] session invalid:", err.code ?? err.message);
  }

  // Нет сессии или она протухла — один и тот же структурированный ответ.
  if (!user) {
    return Response.json(
      { error: "auth", code: "session_expired" },
      { status: 401 },
    );
  }

  // Pro-статус: FREE не пополняет «Советы» из диалога, поэтому инструмент
  // save_tip и правила про сохранение в промпт не подмешиваем.
  const { data: userRow } = await supabase
    .from("users")
    .select("is_pro")
    .eq("id", user.id)
    .maybeSingle();
  const tier = resolveTier(userRow?.is_pro);
  const config = planConfig(tier);
  // save_tip и правила сохранения советов — только для платных тарифов.
  const isPro = tier !== "free";

  // Rate limit по пользователю — backstop против abuse независимо от Pro-статуса.
  const allowed = await checkRateLimit(
    `chat:${user.id}`,
    CHAT_RATE_LIMIT,
    CHAT_RATE_WINDOW_SECONDS,
  );
  if (!allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(CHAT_RATE_WINDOW_SECONDS) } },
    );
  }

  // (a) Стоимость реплики в токенах. Клиент шлёт историю, последняя реплика —
  // новое сообщение пользователя; считаем только его входные токены.
  const lastUserMessage = messages[messages.length - 1];
  const { tokens: inputTokens } = await countMessageTokens(lastUserMessage.content);

  // (b) Жёсткий потолок на одну реплику: блокируем отправку ДО вызова Claude,
  // а не списываем больше единиц. Порог — из конфига тарифа.
  if (inputTokens > config.hard_cap_tokens) {
    return Response.json(
      { error: "message_too_long", maxTokens: config.hard_cap_tokens },
      { status: 413 },
    );
  }

  // (c) Единицы, которые спишет реплика; (d) проверка суточной квоты (для
  // premium — мягкий лимит: не блокирует, только логирует).
  const newUnits = calculateQuotaUnits(inputTokens, config);
  const limitBlock = await checkDailyLimits(
    supabase,
    user.id,
    tier,
    conversationId,
    newUnits,
  );
  if (limitBlock) {
    return Response.json(
      {
        error: "limit_reached",
        reason: limitBlock.reason,
        limit: limitBlock.limit,
        canUpgrade: !isPro,
      },
      { status: 402 },
    );
  }

  // Определяем диалог: при отсутствии id (или если id чужой/удалён) создаём
  // новый. Существующий подгружаем целиком — его сохранённые сообщения нужны,
  // чтобы при дозаписи сохранить их реальные timestamp/inputTokens.
  let convId: string;
  let storedMessages: Message[] = [];
  try {
    const existing = conversationId
      ? await getConversation(supabase, conversationId, user.id)
      : null;
    if (existing) {
      convId = existing.id;
      storedMessages = (existing.messages as Message[]) ?? [];
    } else {
      convId = (await createConversation(supabase, user.id, scenario)).id;
    }
  } catch (err) {
    console.error("[api/chat] conversation resolve failed:", err);
    return Response.json({ error: "Conversation error" }, { status: 500 });
  }

  // В модель уходит окно, в БД — вся история (см. toStore ниже). Обрезка тут,
  // а не на клиенте: клиентская обрезка порезала бы и сохраняемый диалог.
  const anthropicMessages: Anthropic.MessageParam[] = contextWindow(messages).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Активный спринт — добавляем динамический <user_context> в промт.
  const activeSprint = await getActiveSprint(supabase, user.id);
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(scenario, isPro),
      cache_control: { type: "ephemeral" },
    },
  ];
  if (activeSprint) {
    systemBlocks.push({ type: "text", text: buildSprintContext(activeSprint) });
  }

  // Контекст ритма: новая система (фаза цикла) → приоритет. Если нет данных —
  // fallback на старый daily_state (отметки настроения/пробежек).
  const today = new Date().toISOString().slice(0, 10);
  const profile = await getProfile(supabase, user.id);
  let rhythmContextAdded = false;

  if (showRhythm(profile?.gender, profile?.cycle)) {
    const cycles = await getLatestCycles(supabase, user.id, 3);
    if (cycles.length > 0) {
      const cycleLen = getCycleLength(cycles);
      const cycleDay = getCycleDay(cycles[0].started_at, today);
      const phase = getPhase(cycleDay, cycleLen);
      // Вчерашний чек-ин
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const checkin = await getTodayCheckin(supabase, user.id, yesterday.toISOString().slice(0, 10));
      systemBlocks.push({ type: "text", text: buildCycleContext(cycleDay, cycleLen, phase, checkin) });
      rhythmContextAdded = true;
    }
  }

  if (!rhythmContextAdded) {
    // Старый daily_state fallback
    const [latestState] = await getRecentDailyState(supabase, user.id, 1);
    if (latestState) {
      const gapDays = Math.round(
        (parseYmd(userToday()).getTime() - parseYmd(latestState.date).getTime()) / 86_400_000,
      );
      if (gapDays <= 1) {
        systemBlocks.push({
          type: "text",
          text: buildRhythmContext(latestState.moods, latestState.ran),
        });
      }
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";

      // Один стрим-раунд: льём text_delta клиенту (и копим в assistantText),
      // возвращаем финальное сообщение (нужен stop_reason и tool_use-блок).
      const runTurn = async (
        turnMessages: Anthropic.MessageParam[],
        toolChoice?: Anthropic.ToolChoice,
      ) => {
        const turn = anthropic.messages.stream({
          model: NIKA_MODEL,
          max_tokens: 1024,
          system: systemBlocks,
          // Инструменты доступны только PRO.
          ...(isPro ? { tools: [SAVE_TIP_TOOL, LOG_RUN_TOOL] } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          messages: turnMessages,
        });
        for await (const event of turn) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            assistantText += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        return turn.finalMessage();
      };

      try {
        // Раунд 1: НИКА даёт ответ и, если уместно, вызывает save_tip.
        const firstMsg = await runTurn(anthropicMessages);

        // Если модель вызвала инструмент — исполняем на сервере и даём ей
        // продолжить (раунд 2), чтобы финальный текст содержал отметку о
        // сохранении. tool_choice: none в раунде 2 исключает повторный вызов.
        if (isPro && firstMsg.stop_reason === "tool_use") {
          const toolUse = firstMsg.content.find(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUse) {
            let toolResultContent = "";
            let actionToSend: { href: string; label: string } | null = null;

            if (toolUse.name === "save_tip") {
              const result = await executeSaveTip(supabase, user.id, toolUse.input);
              toolResultContent = result.modelMessage;
              if (result.status === "saved") {
                actionToSend = { href: "/tips", label: "Открыть советы" };
              }
            } else if (toolUse.name === "log_run") {
              const result = await executeLogRun(supabase, user.id, toolUse.input);
              toolResultContent = result.modelMessage;
              if (result.ok) {
                actionToSend = { href: "/journal", label: "Открыть журнал" };
              }
            }

            const followup: Anthropic.MessageParam[] = [
              ...anthropicMessages,
              { role: "assistant", content: firstMsg.content },
              {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResultContent }],
              },
            ];
            const sep = "\n\n";
            controller.enqueue(encoder.encode(sep));
            assistantText += sep;
            await runTurn(followup, { type: "none" });

            // Action marker — после всего текста, фронтенд парсит и убирает из отображения.
            if (actionToSend) {
              const marker = encodeAction(actionToSend);
              controller.enqueue(encoder.encode(marker));
              // marker не добавляем в assistantText — не храним в БД
            }
          }
        }

        // Сохраняем полный ход (обмен + ответ НИКИ). Опенер не храним — он
        // подставляется из SCENARIO_META при загрузке. Ошибка сохранения не
        // должна рвать уже доставленный ответ — логируем и продолжаем.
        // (e) Списание единиц происходит именно здесь — после успешной отправки
        // в Claude. Единицы не хранятся отдельным счётчиком: getTodayUsage
        // суммирует их из inputTokens сохранённых реплик. Поэтому если стрим
        // упал выше (catch → controller.error), сохранения нет и квота не
        // списывается — ровно как требуется.
        //
        // Per-message timestamp пишем честно: у ранее сохранённых реплик берём
        // их прежнее время (и inputTokens), новыми считаем только последнюю
        // реплику пользователя и ответ НИКИ. Без этого продолжение старого
        // диалога перебивало бы время всех реплик на «сейчас» и рушило дневной
        // счёт. storedMessages выравниваем по хвосту истории (клиент мог
        // прислать не всю ленту — учитываем сдвиг).
        const now = new Date().toISOString();
        const lastIdx = messages.length - 1;
        const offset = storedMessages.length - lastIdx;
        const toStore: Message[] = messages.map((m, i) => {
          if (i === lastIdx) {
            // Новая реплика пользователя: время сейчас + посчитанные токены.
            return { role: m.role, content: m.content, timestamp: now, inputTokens };
          }
          const prior = offset >= 0 ? storedMessages[offset + i] : undefined;
          return {
            role: m.role,
            content: m.content,
            timestamp: prior?.timestamp ?? now,
            ...(prior?.inputTokens != null ? { inputTokens: prior.inputTokens } : {}),
          };
        });
        toStore.push({ role: "assistant", content: assistantText, timestamp: now });
        try {
          await updateConversation(supabase, convId, user.id, toStore);
        } catch (saveErr) {
          console.error("[api/chat] save failed:", saveErr);
        }

        controller.close();
      } catch (err) {
        console.error("[api/chat] stream error:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Conversation-Id": convId,
      // Отключаем буферизацию у прокси, чтобы токены шли сразу.
      "X-Accel-Buffering": "no",
    },
  });
}
