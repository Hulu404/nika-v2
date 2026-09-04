import { describe, it, expect } from "vitest";
import {
  POLL_CALLBACK_RE,
  buildPollCallback,
  parsePollCallback,
  personLabel,
  pollKeyboard,
  pollReplyText,
  pollText,
  summaryText,
  voteLine,
} from "./poll-copy";
import type { PollSummary, PollVote } from "./poll-store";
import { COFFEE_RUNS } from "../coffeerun/run";

const RUN = COFFEE_RUNS[0];

function vote(name: string, answer: "yes" | "no", username: string | null = null): PollVote {
  return { chatId: 1, name, username, answer, at: "2026-09-04T18:00:00.000Z" };
}

describe("callback_data опроса", () => {
  it("собирается и разбирается обратно вместе с датой забега", () => {
    expect(parsePollCallback(buildPollCallback("yes", RUN.date))).toEqual({
      answer: "yes",
      runDate: RUN.date,
    });
    expect(parsePollCallback(buildPollCallback("no", RUN.date))).toEqual({
      answer: "no",
      runDate: RUN.date,
    });
  });

  it("влезает в лимит Telegram (64 байта)", () => {
    expect(Buffer.byteLength(buildPollCallback("yes", RUN.date))).toBeLessThanOrEqual(64);
  });

  it("не путается с чужими кнопками и мусором", () => {
    expect(parsePollCallback("optin_yes")).toBeNull();
    expect(parsePollCallback("ans_1")).toBeNull();
    expect(parsePollCallback("crp_y_")).toBeNull();
    expect(parsePollCallback("crp_x_2026-09-05")).toBeNull();
    expect(parsePollCallback("crp_y_05.09.2026")).toBeNull();
    expect(parsePollCallback("")).toBeNull();
  });

  it("регексп бота ловит ровно свои данные", () => {
    expect(POLL_CALLBACK_RE.test(buildPollCallback("no", RUN.date))).toBe(true);
    expect(POLL_CALLBACK_RE.test("optin_no")).toBe(false);
  });
});

describe("pollText — что человек читает перед дождём", () => {
  const text = pollText({ name: "Аня" }, RUN);

  it("обращается по имени и называет забег, время и место", () => {
    expect(text).toContain("Аня");
    expect(text).toContain(RUN.spotName);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.startTime);
  });

  it("прямо говорит, что забег не отменён, и спрашивает про дождь", () => {
    expect(text).toContain("не отменяем");
    expect(text.toLowerCase()).toContain("дождь");
  });
});

describe("pollKeyboard — две кнопки ответа", () => {
  it("несёт оба варианта с датой забега внутри", () => {
    const kb = pollKeyboard(RUN.date);
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toContain(buildPollCallback("yes", RUN.date));
    expect(data).toContain(buildPollCallback("no", RUN.date));
  });
});

describe("pollReplyText — ответ бота участнику", () => {
  it("бегущему напоминает время и адрес", () => {
    const text = pollReplyText("yes", RUN);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.address);
  });

  it("отказавшегося не отчитывает и зовёт на следующий", () => {
    const text = pollReplyText("no", RUN);
    expect(text).toContain("следующем");
    expect(text.toLowerCase()).not.toContain("жаль");
  });
});

describe("лента организатора", () => {
  it("подписывает человека именем и ником, а вердикт — словами", () => {
    expect(personLabel({ name: "Аня", username: "anya" })).toBe("Аня (@anya)");
    expect(personLabel({ name: "Аня", username: null })).toBe("Аня");

    const line = voteLine(vote("Аня", "yes", "anya"), { yes: 3, no: 1 });
    expect(line).toContain("Аня (@anya)");
    expect(line).toContain("ПОБЕЖИТ");
    expect(line).toContain("побегут 3, не побегут 1");
  });
});

describe("summaryText — сводка по /poll", () => {
  const summary: PollSummary = {
    runDate: RUN.date,
    yes: [vote("Аня", "yes", "anya"), vote("Игорь", "yes")],
    no: [vote("Лена", "no", "lenka")],
    silent: [{ chatId: 9, name: "Пётр", username: "petya" }],
    asked: 4,
  };

  it("показывает цифры и поимённые списки", () => {
    const text = summaryText(summary, RUN);
    expect(text).toContain("Побегут: 2");
    expect(text).toContain("Не побегут: 1");
    expect(text).toContain("Молчат: 1");
    expect(text).toContain("Всего спросили: 4");
    expect(text).toContain("Аня (@anya)");
    expect(text).toContain("Пётр (@petya)");
    expect(text).toContain(RUN.spotName);
  });

  it("до первой рассылки объясняет, что опроса ещё нет", () => {
    const text = summaryText({ runDate: "", yes: [], no: [], silent: [], asked: 0 }, null);
    expect(text).toContain("/pollsend");
  });
});
