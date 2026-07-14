import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";
import { createConversation, getConversation, updateConversation } from "@/lib/conversations";
import { checkDailyLimits } from "@/lib/limits";
import { calculateQuotaUnits, planConfig } from "@/lib/plans/limits-config";
import { countMessageTokens } from "@/lib/tokens";
import { buildSystemPrompt } from "@/lib/prompts";
import { checkRateLimit } from "@/lib/rate-limit";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { buildSprintContext, getActiveSprint } from "@/lib/sprint";
import { getRecentDailyState, parseYmd, userToday } from "@/lib/rhythm";
import { buildRhythmContext } from "@/lib/rhythm/chat-context";
import { SAVE_TIP_TOOL, executeSaveTip } from "@/lib/tips/save-tip";
import { resolveTier } from "@/lib/subscription";
import { createServerComponentClient } from "@/lib/supabase";
import type { Message } from "@/types/app";
import type { Scenario } from "@/types/conversation";

export const runtime = "nodejs";

// ── Ограничения payload ───────────────────────────────────────────────────────
// Защита от раздувания счёта за токены: один запрос не может нести бесконечную
// историю или гигантские реплики. Клиент шлёт всю историю каждый раз, поэтому
// без этих cap'ов один запрос способен сжечь огромный контекст.
const MAX_MESSAGES = 50; // реплик в истории за запрос
const MAX_MESSAGE_CHARS = 4_000; // символов в одной реплике
const MAX_TOTAL_CHARS = 24_000; // суммарно по всем репликам

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
      return Response.json({ error: "Message too long" }, { status: 400 });
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json({ error: "Conversation too long" }, { status: 400 });
  }

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
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

  // Контекст дня из раздела «Мой ритм»: если есть свежая отметка состояния
  // (сегодня/вчера), передаём её и границы генерации, чтобы «Обсудить в чате»
  // продолжало тот же голос. Берём последнюю запись — так не зависим от TZ.
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
          // save_tip доступен только PRO — FREE «Советы» из диалога не пополняет.
          ...(isPro ? { tools: [SAVE_TIP_TOOL] } : {}),
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
            (b): b is Anthropic.ToolUseBlock =>
              b.type === "tool_use" && b.name === "save_tip",
          );
          if (toolUse) {
            const result = await executeSaveTip(supabase, user.id, toolUse.input);
            const followup: Anthropic.MessageParam[] = [
              ...anthropicMessages,
              { role: "assistant", content: firstMsg.content },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: result.modelMessage,
                  },
                ],
              },
            ];
            // Разделитель между основным ответом и фразой об отметке совета
            const sep = "\n\n";
            controller.enqueue(encoder.encode(sep));
            assistantText += sep;
            await runTurn(followup, { type: "none" });
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
