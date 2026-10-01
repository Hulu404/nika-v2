import { describe, expect, it } from "vitest";
import { parseTaskList, TaskListError } from "./task-list";

describe("parseTaskList", () => {
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
