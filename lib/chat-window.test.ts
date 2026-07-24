import { describe, it, expect } from "vitest";
import {
  contextWindow,
  CONTEXT_MAX_MESSAGES,
  CONTEXT_MAX_CHARS,
  type WindowMessage,
} from "@/lib/chat-window";

/** Диалог из n реплик, чередующихся user/assistant, начиная с user. */
function dialogue(n: number, contentLen = 10): WindowMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: "x".repeat(contentLen),
  }));
}

describe("contextWindow", () => {
  it("короткий диалог отдаёт целиком", () => {
    const all = dialogue(6);
    expect(contextWindow(all)).toHaveLength(6);
    expect(contextWindow(all)).toEqual(all);
  });

  it("пустой список не ломает", () => {
    expect(contextWindow([])).toEqual([]);
  });

  it("длинный диалог обрезает по числу реплик, а не отвергает", () => {
    // Главный регресс: раньше 400 реплик = молчаливый 400 и мёртвый тред.
    const win = contextWindow(dialogue(400));
    expect(win.length).toBeLessThanOrEqual(CONTEXT_MAX_MESSAGES);
    expect(win.length).toBeGreaterThan(0);
  });

  it("окно всегда начинается с реплики пользователя", () => {
    // Anthropic требует первым сообщение от user. Срез по чётной границе мог бы
    // начаться с ответа НИКИ — проверяем на обеих чётностях длины.
    for (const n of [200, 201, 77, 50, 51]) {
      const win = contextWindow(dialogue(n));
      expect(win[0].role, `длина ${n}`).toBe("user");
    }
  });

  it("последняя реплика всегда в окне", () => {
    const all = dialogue(300);
    all[all.length - 1] = { role: "user", content: "ПОСЛЕДНЯЯ" };
    const win = contextWindow(all);
    expect(win[win.length - 1].content).toBe("ПОСЛЕДНЯЯ");
  });

  it("обрезает по символам, когда реплик мало, но они огромные", () => {
    // 20 реплик по 3000 символов = 60 000 > CONTEXT_MAX_CHARS.
    const win = contextWindow(dialogue(20, 3_000));
    const chars = win.reduce((s, m) => s + m.content.length, 0);
    expect(chars).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
    expect(win[0].role).toBe("user");
  });

  it("одна гигантская последняя реплика не выбрасывается", () => {
    // Её отсекает потолок по токенам (413), а не окно — иначе ушёл бы пустой
    // список и Anthropic вернул бы ошибку.
    const all: WindowMessage[] = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "c".repeat(CONTEXT_MAX_CHARS * 2) },
    ];
    const win = contextWindow(all);
    expect(win.length).toBeGreaterThan(0);
    expect(win[win.length - 1].content).toHaveLength(CONTEXT_MAX_CHARS * 2);
    expect(win[0].role).toBe("user");
  });
});
