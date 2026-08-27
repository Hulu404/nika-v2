import { describe, it, expect } from "vitest";
import { confirmationText, parseCoffeeRunToken, reminderText } from "./coffeerun";
import { COFFEE_RUNS } from "../coffeerun/run";

const RUN = COFFEE_RUNS[0];
const SIGNUP = { name: "Аня", email: "anna@mail.ru", tg_username: "annaruns" };

describe("parseCoffeeRunToken — отделяем deep-link кофе-рана от привязки аккаунта", () => {
  it("достаёт токен из cr_<hex>", () => {
    const hex = "a".repeat(32);
    expect(parseCoffeeRunToken(`cr_${hex}`)).toBe(hex);
    expect(parseCoffeeRunToken(`  cr_${hex}  `)).toBe(hex);
  });

  it("не трогает токены привязки аккаунта и мусор", () => {
    expect(parseCoffeeRunToken("550e8400-e29b-41d4-a716-446655440000")).toBeNull();
    expect(parseCoffeeRunToken("cr_")).toBeNull();
    expect(parseCoffeeRunToken("cr_не-хекс")).toBeNull();
    expect(parseCoffeeRunToken("")).toBeNull();
  });
});

describe("confirmationText — что человек читает после подтверждения", () => {
  it("показывает данные заявки и детали ближайшего забега", () => {
    const text = confirmationText(SIGNUP, RUN, "annaruns");
    expect(text).toContain("Имя: Аня");
    expect(text).toContain("Telegram: @annaruns");
    expect(text).toContain("E-mail: anna@mail.ru");
    expect(text).toContain("Вы успешно зарегистрированы!");
    expect(text).toContain(RUN.dateLabel);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.address);
  });

  it("при расхождении ников говорит, какой оставили", () => {
    const text = confirmationText(SIGNUP, RUN, "anna_real");
    expect(text).toContain("@anna_real");
    expect(text).toContain("В заявке был указан @annaruns");
  });

  it("молчит о расхождении, когда ник совпал", () => {
    expect(confirmationText(SIGNUP, RUN, "annaruns")).not.toContain("В заявке был указан");
  });

  it("без ника в Telegram обходится ником из заявки", () => {
    const text = confirmationText(SIGNUP, RUN, null);
    expect(text).toContain("Telegram: @annaruns");
    expect(text).not.toContain("В заявке был указан");
  });

  it("повторное подтверждение не выглядит как вторая регистрация", () => {
    const text = confirmationText(SIGNUP, RUN, "annaruns", true);
    expect(text).toContain("Ты уже в списке");
    expect(text).toContain("Вы успешно зарегистрированы!");
  });
});

describe("reminderText — напоминание накануне", () => {
  it("зовёт по имени и даёт время, место и дистанцию", () => {
    const text = reminderText(SIGNUP, RUN);
    expect(text).toContain("Аня");
    expect(text).toContain("завтра");
    expect(text).toContain(RUN.dateLabel);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.startTime);
    expect(text).toContain(RUN.address);
    expect(text).toContain(RUN.distance);
  });

  it("не повторяет формулировку регистрации — человек уже подтвердил", () => {
    expect(reminderText(SIGNUP, RUN)).not.toContain("Вы успешно зарегистрированы");
  });

  it("не тянет в текст почту и ник — это напоминание, а не карточка заявки", () => {
    const text = reminderText(SIGNUP, RUN);
    expect(text).not.toContain(SIGNUP.email);
    expect(text).not.toContain(SIGNUP.tg_username);
  });
});
