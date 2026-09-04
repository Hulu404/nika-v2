import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetPollStateForTests,
  addAdminChat,
  adminChats,
  alreadyAsked,
  alreadyNotified,
  isAdminChat,
  markNotified,
  markSent,
  pollRunDate,
  pollSummary,
  recordVote,
  removeAdminChat,
  startPoll,
} from "./poll-store";

beforeEach(() => {
  __resetPollStateForTests();
});

describe("рассылка опроса", () => {
  it("не спрашивает одного человека дважды", () => {
    startPoll("2026-09-05");

    expect(alreadyAsked(111)).toBe(false);
    markSent({ chatId: 111, name: "Аня", username: "anya" });
    expect(alreadyAsked(111)).toBe(true);
    expect(alreadyAsked(222)).toBe(false);
  });

  it("новый забег обнуляет ответы, но не список организаторов", () => {
    startPoll("2026-09-05");
    addAdminChat(777);
    markSent({ chatId: 111, name: "Аня", username: "anya" });
    recordVote(111, "yes", { name: "Аня", username: "anya" });

    startPoll("2026-09-06");

    expect(pollRunDate()).toBe("2026-09-06");
    expect(pollSummary().yes).toHaveLength(0);
    expect(alreadyAsked(111)).toBe(false);
    expect(adminChats()).toEqual([777]);
  });
});

describe("ответы", () => {
  it("считает голоса и помнит, кто ещё молчит", () => {
    startPoll("2026-09-05");
    markSent({ chatId: 1, name: "Аня", username: "anya" });
    markSent({ chatId: 2, name: "Игорь", username: null });
    markSent({ chatId: 3, name: "Пётр", username: "petya" });

    recordVote(1, "yes", { name: "не важно", username: null });
    recordVote(2, "no", { name: "не важно", username: null });

    const summary = pollSummary();
    expect(summary.yes.map((v) => v.name)).toEqual(["Аня"]);
    expect(summary.no.map((v) => v.name)).toEqual(["Игорь"]);
    expect(summary.silent.map((p) => p.name)).toEqual(["Пётр"]);
    expect(summary.asked).toBe(3);
  });

  it("берёт имя из заявки, а не из профиля Telegram", () => {
    startPoll("2026-09-05");
    markSent({ chatId: 1, name: "Анна Петрова", username: "anya" });

    const vote = recordVote(1, "yes", { name: "Анюта 🌸", username: "anya" });
    expect(vote.name).toBe("Анна Петрова");
  });

  it("а без карточки рассылки — из профиля Telegram", () => {
    startPoll("2026-09-05");

    const vote = recordVote(42, "no", { name: "Незнакомец", username: "unknown" });
    expect(vote.name).toBe("Незнакомец");
    expect(pollSummary().no).toHaveLength(1);
  });

  it("человек может передумать — считается последнее нажатие", () => {
    startPoll("2026-09-05");
    markSent({ chatId: 1, name: "Аня", username: "anya" });

    recordVote(1, "yes", { name: "Аня", username: "anya" });
    recordVote(1, "no", { name: "Аня", username: "anya" });

    const summary = pollSummary();
    expect(summary.yes).toHaveLength(0);
    expect(summary.no).toHaveLength(1);
  });
});

describe("доступ организатора", () => {
  it("подписка и отписка чата", () => {
    expect(isAdminChat(777)).toBe(false);

    addAdminChat(777);
    addAdminChat(777); // повтор не двоит
    expect(adminChats()).toEqual([777]);

    removeAdminChat(777);
    expect(isAdminChat(777)).toBe(false);
  });
});

describe("разовые объявления (перенос старта)", () => {
  it("не отправляет одно и то же объявление дважды", () => {
    const key = "moved:2026-09-05:18:00";
    expect(alreadyNotified(key, 1)).toBe(false);

    markNotified(key, 1);
    expect(alreadyNotified(key, 1)).toBe(true);
    expect(alreadyNotified(key, 2)).toBe(false);
  });

  it("новое время — новое объявление, уходит всем заново", () => {
    markNotified("moved:2026-09-05:18:00", 1);
    expect(alreadyNotified("moved:2026-09-05:19:00", 1)).toBe(false);
  });

  it("переживает запуск опроса по другому забегу", () => {
    const key = "moved:2026-09-05:18:00";
    markNotified(key, 1);

    startPoll("2026-09-06");

    expect(alreadyNotified(key, 1)).toBe(true);
  });
});
