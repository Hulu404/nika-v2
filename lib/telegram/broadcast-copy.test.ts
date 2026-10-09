import { describe, it, expect } from "vitest";
import {
  ADMIN_COMMANDS,
  BROADCAST_CALLBACK_RE,
  broadcastConfirmKeyboard,
  broadcastPreviewText,
  broadcastReportText,
  parseBroadcastCallback,
} from "./broadcast-copy";
import { broadcastAudience, broadcastKey } from "../coffeerun/broadcast-dispatch";

describe("broadcastPreviewText — предпросмотр общей рассылки", () => {
  it("называет число получателей и спрашивает подтверждение", () => {
    const text = broadcastPreviewText(171, { optedOut: 0 });
    expect(text).toContain("171");
    expect(text).toContain("Отправляем?");
    expect(text).not.toContain("Пропускаю");
  });

  it("говорит, скольких пропускает по /stop", () => {
    expect(broadcastPreviewText(10, { optedOut: 3 })).toContain("просили не писать: 3");
  });
});

describe("кнопки общей рассылки", () => {
  it("кнопка «Разослать» несёт id сообщения и разбирается обратно", () => {
    const kb = broadcastConfirmKeyboard(4242);
    const data = kb.inline_keyboard[0][0];
    expect("callback_data" in data && data.callback_data).toBe("bc_go_4242");
    expect(parseBroadcastCallback("bc_go_4242")).toEqual({ action: "send", messageId: 4242 });
  });

  it("«Отмена» и чужие данные", () => {
    expect(parseBroadcastCallback("bc_no")).toEqual({ action: "cancel" });
    expect(parseBroadcastCallback("op_no")).toBeNull();
    expect(parseBroadcastCallback("bc_go_")).toBeNull();
    expect(BROADCAST_CALLBACK_RE.test("bc_go_12abc")).toBe(false);
  });
});

describe("broadcastReportText — итог для организатора", () => {
  it("считает доставленных и заблокировавших", () => {
    expect(broadcastReportText({ sent: 5, blocked: 1, failed: 0 })).toBe(
      "Разослала: 5. Заблокировали бота: 1. Не дошло: 0.",
    );
  });

  it("при недошедших подсказывает про досылку", () => {
    expect(broadcastReportText({ sent: 5, failed: 2 })).toContain("дошлёт");
  });
});

describe("broadcastAudience — кому уходит общая рассылка", () => {
  it("пропускает отписавшихся и уже получивших", () => {
    const res = broadcastAudience([1, 2, 3, 4], new Set([2]), (id) => id === 3);
    expect(res).toEqual({ due: [1, 4], optedOut: 1 });
  });

  it("ключ дедупа у каждого сообщения свой", () => {
    expect(broadcastKey({ fromChatId: 7, messageId: 1 })).not.toBe(
      broadcastKey({ fromChatId: 7, messageId: 2 }),
    );
  });
});

describe("ADMIN_COMMANDS — меню организатора", () => {
  it("есть общая рассылка, а команды подходят под правила Telegram", () => {
    expect(ADMIN_COMMANDS.map((c) => c.command)).toContain("say");
    for (const c of ADMIN_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(2);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });
});
