import { describe, it, expect } from "vitest";
import { canReceiveBotMessages } from "./gate";

describe("canReceiveBotMessages — гейт бот-инициированных сообщений", () => {
  it("пускает только активную связку с согласием", () => {
    expect(canReceiveBotMessages({ is_active: true, tg_opt_in: true })).toBe(true);
  });

  it("не пускает без согласия (opt-in выключен)", () => {
    expect(canReceiveBotMessages({ is_active: true, tg_opt_in: false })).toBe(false);
  });

  it("не пускает отвязанного, даже если opt-in когда-то был", () => {
    expect(canReceiveBotMessages({ is_active: false, tg_opt_in: true })).toBe(false);
  });

  it("не пускает при отсутствии связки/полей", () => {
    expect(canReceiveBotMessages(null)).toBe(false);
    expect(canReceiveBotMessages(undefined)).toBe(false);
    expect(canReceiveBotMessages({})).toBe(false);
    expect(canReceiveBotMessages({ is_active: null, tg_opt_in: null })).toBe(false);
  });
});
