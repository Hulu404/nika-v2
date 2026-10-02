import { describe, expect, it } from "vitest";
import { parseTaskList, TaskListError } from "./task-list";

describe("parseTaskList", () => {
  it("expands -- rows into one assignment per unique recipient", () => {
    expect(parseTaskList("/assign\n1. Сделать макет -- пт 18:00 -- @ALICE + bob\n2. Проверить -- 03.10 -- @bob", new Date("2026-10-01T09:00:00Z")))
      .toEqual([
        { line: 2, username: "alice", what: "Сделать макет", due_at: "2026-10-02T15:00:00.000Z" },
        { line: 2, username: "bob", what: "Сделать макет", due_at: "2026-10-02T15:00:00.000Z" },
        { line: 3, username: "bob", what: "Проверить", due_at: "2026-10-03T20:59:00.000Z" },
      ]);
  });

  it("rejects malformed -- rows and repeated recipients", () => {
    const now = new Date("2026-10-01T09:00:00Z");
    expect(() => parseTaskList("Макет -- завтра -- @alice + @ALICE", now)).toThrow("несколько раз");
    expect(() => parseTaskList("Макет -- завтра -- @alice +", now)).toThrow("ники исполнителей");
    expect(() => parseTaskList("Макет -- завтра", now)).toThrow("Нужны три поля");
  });
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
