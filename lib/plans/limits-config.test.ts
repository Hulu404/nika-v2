import { describe, it, expect } from "vitest";
import { calculateQuotaUnits, planConfig, PLAN_LIMITS } from "@/lib/plans/limits-config";

describe("calculateQuotaUnits (пункт 1)", () => {
  const cfg = planConfig("free"); // unit_tokens = 250

  it("ровно на границе (250 токенов) → 1 единица", () => {
    expect(calculateQuotaUnits(250, cfg)).toBe(1);
  });

  it("250 + 1 токен → 2 единицы", () => {
    expect(calculateQuotaUnits(251, cfg)).toBe(2);
  });

  it("0 токенов (пустое) → 1 единица", () => {
    // Решение: минимум 1 единица (Math.max(1, ...)).
    // Почему: 0 — лишь теоретический пол — пустые сообщения отсекаются
    // валидацией контента раньше. Но любое реально отправленное в Claude
    // сообщение несёт базовую стоимость, поэтому «бесплатных» сообщений быть
    // не должно: минимальная цена — 1 единица.
    expect(calculateQuotaUnits(0, cfg)).toBe(1);
  });

  it("длинные сообщения списывают несколько единиц", () => {
    expect(calculateQuotaUnits(500, cfg)).toBe(2);
    expect(calculateQuotaUnits(700, cfg)).toBe(3);
    expect(calculateQuotaUnits(2500, cfg)).toBe(10);
  });

  it("premium с другим unit_tokens считается по своему конфигу", () => {
    // unit_tokens одинаковый (250), но проверяем, что берётся из переданного
    // конфига, а не из константы.
    const custom = { ...planConfig("premium"), unit_tokens: 1000 };
    expect(calculateQuotaUnits(1000, custom)).toBe(1);
    expect(calculateQuotaUnits(1001, custom)).toBe(2);
  });

  it("конфиг тарифов соответствует бизнес-спеке", () => {
    expect(PLAN_LIMITS.free).toMatchObject({ hard_cap_tokens: 2500, hard_block: true });
    expect(PLAN_LIMITS.pro).toMatchObject({ hard_cap_tokens: 2500, hard_block: true });
    expect(PLAN_LIMITS.premium).toMatchObject({ hard_cap_tokens: 4000, hard_block: false });
  });
});
