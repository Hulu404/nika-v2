import { describe, it, expect } from "vitest";
import { signupStatus, summarizeSignups, viewSignups, type SignupRow } from "./stats";

/**
 * Разбор заявок по статусам — место, где ошибка тихая и дорогая: сводка
 * покажет «все подтвердились», а половина людей не получит ни напоминания, ни
 * отмены. Поэтому оно проверяется без базы и без часов.
 */

const NOW = new Date("2026-09-18T12:00:00Z");

function row(over: Partial<SignupRow> = {}): SignupRow {
  return {
    name: "Аня",
    contact: "@anya",
    pace: null,
    created_at: "2026-09-10T09:00:00Z",
    confirmed_at: null,
    reminder_sent_at: null,
    tg_username: "anya",
    tg_chat_id: null,
    ...over,
  };
}

describe("signupStatus", () => {
  it("ушедшее напоминание — главный признак, остальное уже не важно", () => {
    expect(
      signupStatus(row({ reminder_sent_at: "2026-09-18T07:00:00Z", confirmed_at: null })),
    ).toBe("reminded");
  });

  it("подтвердился и есть чат — ждёт напоминания", () => {
    expect(signupStatus(row({ confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 42 }))).toBe(
      "waiting",
    );
  });

  it("голая заявка с формы — не подтвердился", () => {
    expect(signupStatus(row())).toBe("unconfirmed");
  });

  it("подтверждение без chat_id — всё равно не подтвердился: рассылка его не возьмёт", () => {
    // Фильтр в reminder-dispatch требует И confirmed_at, И tg_chat_id. Такая
    // строка не уйдёт в рассылку никогда, и «ждёт» про неё было бы ложью.
    expect(signupStatus(row({ confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: null }))).toBe(
      "unconfirmed",
    );
  });
});

describe("viewSignups", () => {
  it("наверх поднимает тех, с кем надо что-то делать", () => {
    const rows = [
      row({ name: "Напомнили", reminder_sent_at: "2026-09-18T07:00:00Z" }),
      row({ name: "Ждёт", confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 1 }),
      row({ name: "Висит" }),
    ];
    expect(viewSignups(rows).map((v) => v.name)).toEqual(["Висит", "Ждёт", "Напомнили"]);
  });

  it("внутри группы — по времени заявки, кто раньше записался", () => {
    const rows = [
      row({ name: "Поздняя", created_at: "2026-09-12T10:00:00Z" }),
      row({ name: "Ранняя", created_at: "2026-09-09T10:00:00Z" }),
    ];
    expect(viewSignups(rows).map((v) => v.name)).toEqual(["Ранняя", "Поздняя"]);
  });
});

describe("summarizeSignups", () => {
  it("считает группы и не теряет никого", () => {
    const rows = [
      row({ reminder_sent_at: "2026-09-18T07:00:00Z" }),
      row({ reminder_sent_at: "2026-09-18T07:01:00Z" }),
      row({ confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 1 }),
      row(),
      row(),
    ];
    const s = summarizeSignups(rows, NOW);
    expect(s.total).toBe(5);
    expect(s.reminded).toBe(2);
    expect(s.waiting).toBe(1);
    expect(s.unconfirmed).toBe(2);
    // Подтвердившиеся — это те, до кого бот дотянется, а не только те, кому
    // уже написали.
    expect(s.confirmed).toBe(3);
    expect(s.reminded + s.waiting + s.unconfirmed).toBe(s.total);
  });

  it("темпы идут в порядке из pace.ts, включая пустые группы", () => {
    const s = summarizeSignups(
      [row({ pace: "8:00" }), row({ pace: "6:30" }), row({ pace: "6:30" })],
      NOW,
    );
    // Группа с нулём остаётся в списке: пейсеров трое, и «в 7:00 никого» —
    // это ответ, а не отсутствие ответа. Прячет пустые уже показ (copy.ts).
    expect(s.byPace).toEqual([
      { pace: "6:30", count: 2 },
      { pace: "7:00", count: 0 },
      { pace: "8:00", count: 1 },
    ]);
  });

  it("заявки без темпа считаются отдельной группой в конце", () => {
    const s = summarizeSignups([row({ pace: "7:00" }), row({ pace: null })], NOW);
    expect(s.byPace.at(-1)).toEqual({ pace: null, count: 1 });
  });

  it("за сутки считает от переданного момента, а не от системных часов", () => {
    const s = summarizeSignups(
      [
        row({ created_at: "2026-09-18T06:00:00Z" }), // 6 часов назад
        row({ created_at: "2026-09-16T06:00:00Z" }), // двое суток назад
      ],
      NOW,
    );
    expect(s.last24h).toBe(1);
  });

  it("пустой забег — нули и никаких дат, а не падение", () => {
    const s = summarizeSignups([], NOW);
    expect(s.total).toBe(0);
    expect(s.byPace.every((b) => b.count === 0)).toBe(true);
    expect(s.lastSignupAt).toBeNull();
    expect(s.lastReminderAt).toBeNull();
  });

  it("последняя заявка и последнее напоминание — самые свежие, а не первые попавшиеся", () => {
    const s = summarizeSignups(
      [
        row({ created_at: "2026-09-10T09:00:00Z", reminder_sent_at: "2026-09-18T07:00:00Z" }),
        row({ created_at: "2026-09-14T09:00:00Z", reminder_sent_at: "2026-09-18T07:05:00Z" }),
        row({ created_at: "2026-09-12T09:00:00Z" }),
      ],
      NOW,
    );
    expect(s.lastSignupAt).toBe("2026-09-14T09:00:00Z");
    expect(s.lastReminderAt).toBe("2026-09-18T07:05:00Z");
  });
});
