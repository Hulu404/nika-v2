import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Моки зависимостей роута ───────────────────────────────────────────────────
// Мокаем всё «тяжёлое»/сетевое, оставляя реальными проверяемую логику потолка
// (route + @/lib/plans/limits-config) и валидацию сценариев (@/lib/scenarios).
vi.mock("@/lib/supabase", () => ({
  createServerComponentClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_pro: false } }) }) }),
    }),
  })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/subscription", () => ({
  FORCE_PRO_FOR_ALL: false,
  resolveTier: vi.fn(() => "free"),
}));
vi.mock("@/lib/tokens", () => ({ countMessageTokens: vi.fn() }));
vi.mock("@/lib/limits", () => ({ checkDailyLimits: vi.fn(async () => null) }));
vi.mock("@/lib/anthropic", () => ({
  anthropic: { messages: { stream: vi.fn() } },
  NIKA_MODEL: "test-model",
}));
vi.mock("@/lib/conversations", () => ({
  createConversation: vi.fn(async () => ({ id: "c1" })),
  getConversation: vi.fn(async () => ({ id: "c1", messages: [] })),
  updateConversation: vi.fn(async () => {}),
}));
vi.mock("@/lib/sprint", () => ({
  getActiveSprint: vi.fn(async () => null),
  buildSprintContext: vi.fn(() => ""),
}));
vi.mock("@/lib/rhythm", () => ({
  getRecentDailyState: vi.fn(async () => []),
  parseYmd: vi.fn(() => new Date()),
  userToday: vi.fn(() => "2026-07-12"),
}));
vi.mock("@/lib/rhythm/chat-context", () => ({ buildRhythmContext: vi.fn(() => "") }));
vi.mock("@/lib/prompts", () => ({ buildSystemPrompt: vi.fn(() => "sys") }));
vi.mock("@/lib/tips/save-tip", () => ({
  SAVE_TIP_TOOL: { name: "save_tip" },
  executeSaveTip: vi.fn(async () => ({ modelMessage: "ok" })),
}));

import { POST } from "@/app/api/chat/route";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { countMessageTokens } from "@/lib/tokens";
import { checkDailyLimits } from "@/lib/limits";
import { anthropic } from "@/lib/anthropic";
import { updateConversation } from "@/lib/conversations";
import { resolveTier } from "@/lib/subscription";

const scenario = ALL_SCENARIOS[0];

function makeReq(content = "привет") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, messages: [{ role: "user", content }], conversationId: null }),
  });
}

/** Стрим Claude, который падает при первой же итерации. */
function throwingStream() {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.reject(new Error("boom")) };
    },
    finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTier).mockReturnValue("free");
  vi.mocked(checkDailyLimits).mockResolvedValue(null);
});

describe("POST /api/chat — жёсткий потолок токенов (пункты 2, 3)", () => {
  it("free: сообщение выше hard_cap (2500) → 413 ДО Claude, квота не трогается", async () => {
    vi.mocked(countMessageTokens).mockResolvedValue({ tokens: 3000, estimated: false });

    const res = await POST(makeReq());

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "message_too_long", maxTokens: 2500 });
    // Ранний возврат: ни проверки квоты, ни вызова Claude, ни сохранения.
    expect(checkDailyLimits).not.toHaveBeenCalled();
    expect(anthropic.messages.stream).not.toHaveBeenCalled();
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it("premium: hard_cap выше (4000) — 3500 токенов проходит потолок", async () => {
    // ВАЖНО: жёсткий потолок блокирует ВСЕ тарифы (см. промпт 0: «после него
    // отправка блокируется»). «Мягкость» премиума — только про суточную КВОТУ
    // (тест в lib/limits.test.ts), а не про потолок одной реплики. Здесь у
    // премиума просто выше сам порог (4000 против 2500).
    vi.mocked(resolveTier).mockReturnValue("premium");
    vi.mocked(countMessageTokens).mockResolvedValue({ tokens: 3500, estimated: false });
    vi.mocked(anthropic.messages.stream).mockReturnValue(throwingStream());

    const res = await POST(makeReq());

    // Потолок не сработал → дошли до проверки квоты и до Claude.
    expect(res.status).toBe(200);
    expect(checkDailyLimits).toHaveBeenCalledOnce();
    expect(anthropic.messages.stream).toHaveBeenCalledOnce();
    // добиваем стрим, чтобы не висел
    await res.body!.getReader().read().catch(() => {});
  });

  it("premium: выше своего hard_cap (4000) → 413 (потолок universсален)", async () => {
    vi.mocked(resolveTier).mockReturnValue("premium");
    vi.mocked(countMessageTokens).mockResolvedValue({ tokens: 4500, estimated: false });

    const res = await POST(makeReq());

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ maxTokens: 4000 });
    expect(anthropic.messages.stream).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — сбой Claude после прохождения лимита (пункт 6)", () => {
  it("стрим падает → диалог НЕ сохраняется, единицы не списываются", async () => {
    vi.mocked(countMessageTokens).mockResolvedValue({ tokens: 50, estimated: false });
    vi.mocked(checkDailyLimits).mockResolvedValue(null); // лимит пройден
    vi.mocked(anthropic.messages.stream).mockReturnValue(throwingStream());

    const res = await POST(makeReq());
    expect(res.status).toBe(200); // ответ уже начал стримиться

    // Прокачиваем тело — стрим должен упасть.
    const reader = res.body!.getReader();
    let errored = false;
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      errored = true;
    }

    expect(errored).toBe(true);
    // Списание = сохранение реплики. Сохранения не было → квота не списана.
    expect(updateConversation).not.toHaveBeenCalled();
  });
});
