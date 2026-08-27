import { describe, it, expect } from "vitest";
import { normalizeTelegramUsername } from "./telegram-username";

describe("normalizeTelegramUsername — контакт кофе-рана строго телеграм", () => {
  it("приводит к канону: без @, нижний регистр, без пробелов", () => {
    expect(normalizeTelegramUsername("@AnnaRuns")).toBe("annaruns");
    expect(normalizeTelegramUsername("  anna_runs  ")).toBe("anna_runs");
  });

  it("принимает ссылку вместо ника", () => {
    expect(normalizeTelegramUsername("https://t.me/annaruns")).toBe("annaruns");
    expect(normalizeTelegramUsername("t.me/AnnaRuns")).toBe("annaruns");
    expect(normalizeTelegramUsername("https://telegram.me/annaruns?start=1")).toBe("annaruns");
  });

  it("отбивает телефон — это была вторая половина старого поля «Телефон или Telegram»", () => {
    expect(normalizeTelegramUsername("+7 999 000-00-00")).toBeNull();
    expect(normalizeTelegramUsername("89990000000")).toBeNull();
  });

  it("отбивает то, что не может быть ником Telegram", () => {
    expect(normalizeTelegramUsername("anna")).toBeNull(); // короче 5 символов
    expect(normalizeTelegramUsername("a".repeat(33))).toBeNull(); // длиннее 32
    expect(normalizeTelegramUsername("1annaruns")).toBeNull(); // начинается не с буквы
    expect(normalizeTelegramUsername("annaruns_")).toBeNull(); // заканчивается на _
    expect(normalizeTelegramUsername("анна_бежит")).toBeNull(); // кириллица
    expect(normalizeTelegramUsername("anna runs")).toBeNull();
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername(null)).toBeNull();
    expect(normalizeTelegramUsername(undefined)).toBeNull();
  });
});
