import { describe, expect, it } from "vitest";
import { parseTaskList, TaskListError } from "./task-list";

describe("parseTaskList", () => {
  it("reads what / deadline / recipient and keeps the deadline", () => {
    expect(parseTaskList("/assign\nПодготовить макет / пт 18:00 / @ALICE\nПроверить текст / 03.10 / @bob", new Date("2026-10-01T09:00:00Z")))
      .toEqual([
        { line: 2, username: "alice", what: "Подготовить макет", due_at: "2026-10-02T15:00:00.000Z" },
        { line: 3, username: "bob", what: "Проверить текст", due_at: "2026-10-03T20:59:00.000Z" },
      ]);
  });

  it("rejects an incomplete slash row and a past deadline", () => {
    const now = new Date("2026-10-01T09:00:00Z");
    expect(() => parseTaskList("Макет / @alice", now)).toThrow("Нужны три поля");
    expect(() => parseTaskList("Макет / 30.09 / @alice", now)).toThrow("Срок уже прошёл");
  });

  it("accepts slash fields without spaces", () => {
    expect(parseTaskList("Макет/завтра 18:00/@alice", new Date("2026-10-01T09:00:00Z"))[0])
      .toMatchObject({ username: "alice", what: "Макет", due_at: "2026-10-02T15:00:00.000Z" });
  });

  it("splits a numbered owner message and normalizes exact usernames", () => {
    expect(parseTaskList("/assign\n1. @ALICE — Подготовить макет\n2) Проверить текст @Bob_2"))
      .toEqual([
        { line: 2, username: "alice", what: "Подготовить макет", due_at: null },
        { line: 3, username: "bob_2", what: "Проверить текст", due_at: null },
      ]);
  });

  it("rejects lines without a unique recipient", () => {
    expect(() => parseTaskList("Подготовить макет")).toThrow(TaskListError);
    expect(() => parseTaskList("@alice и @bob — подготовить макет")).toThrow(TaskListError);
  });
});
