import { describe, it, expect } from "vitest";
import {
  CANCEL_CALLBACK_RE,
  MOVED_CALLBACK_RE,
  cancelConfirmKeyboard,
  cancelKeyboard,
  cancelPreviewText,
  cancelText,
  gatherFor,
  movedConfirmKeyboard,
  movedPreviewText,
  noticeReportText,
  movedText,
  parseCancelCallback,
  parseMovedCallback,
  parseTime,
} from "./notice-copy";
import { parseCancelArgs, parseMovedArgs } from "./coffeerun-notice";
import { COFFEE_RUNS } from "../coffeerun/run";

const RUN = COFFEE_RUNS[0];

describe("parseTime — время из команды", () => {
  it("понимает привычные записи", () => {
    expect(parseTime("18:00")).toBe("18:00");
    expect(parseTime("18.00")).toBe("18:00");
    expect(parseTime("18")).toBe("18:00");
    expect(parseTime("9:05")).toBe("9:05");
    expect(parseTime(" 19:30 ")).toBe("19:30");
  });

  it("отбрасывает не время", () => {
    expect(parseTime("дождь")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("18:70")).toBeNull();
    expect(parseTime("2026-09-05")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("gatherFor — сбор за 15 минут до старта", () => {
  it("считает от нового времени", () => {
    expect(gatherFor("18:00")).toBe("17:45");
    expect(gatherFor("19:30")).toBe("19:15");
    expect(gatherFor("9:05")).toBe("8:50");
  });

  it("не уходит в минус около полуночи", () => {
    expect(gatherFor("0:10")).toBe("23:55");
  });
});

describe("parseMovedArgs — аргументы команды в любом порядке", () => {
  it("без аргументов переносит ближайший забег на 18:00", () => {
    expect(parseMovedArgs("")).toEqual({ runDate: null, newStart: "18:00", reason: null });
  });

  it("берёт своё время", () => {
    expect(parseMovedArgs("19:00")).toEqual({ runDate: null, newStart: "19:00", reason: null });
  });

  it("различает дату, время и причину", () => {
    expect(parseMovedArgs("2026-09-06 19:00 ливень с грозой")).toEqual({
      runDate: "2026-09-06",
      newStart: "19:00",
      reason: "ливень с грозой",
    });
  });

  it("причина без времени не съедает время по умолчанию", () => {
    expect(parseMovedArgs("дождь")).toEqual({
      runDate: null,
      newStart: "18:00",
      reason: "дождь",
    });
  });
});

describe("movedText — что читает участник", () => {
  const text = movedText({ name: "Аня" }, RUN, "18:00", "дождь");

  it("новое время стоит в первой строке — его видно в превью чата", () => {
    expect(text.split("\n")[0]).toContain("18:00");
    expect(text.split("\n")[0]).toContain("Аня");
  });

  it("называет и старое время, чтобы никто не пришёл к нему", () => {
    expect(text).toContain(RUN.startTime);
  });

  it("даёт место, сбор и причину", () => {
    expect(text).toContain(RUN.address);
    expect(text).toContain("17:45");
    expect(text).toContain("Причина: дождь");
  });

  it("без причины строку про причину не печатает", () => {
    expect(movedText({ name: "Аня" }, RUN, "18:00", null)).not.toContain("Причина");
  });

  it("не давит на тех, кто вечером не сможет", () => {
    expect(text).toContain("ничего страшного");
  });
});

describe("предпросмотр для организатора", () => {
  it("показывает забег, оба времени, число получателей и сам текст", () => {
    const preview = movedPreviewText(RUN, "18:00", "дождь", 29);
    expect(preview).toContain(RUN.spotName);
    expect(preview).toContain("Новый старт: 18:00");
    expect(preview).toContain(`было ${RUN.startTime}`);
    expect(preview).toContain("29 чел.");
    expect(preview).toContain("Причина: дождь");
  });
});

describe("кнопки подтверждения", () => {
  it("несут дату забега и новое время", () => {
    const kb = movedConfirmKeyboard(RUN.date, "18:00");
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toContain(`mv_go_${RUN.date}_18:00`);
    expect(data).toContain("mv_no");
  });

  it("разбираются обратно", () => {
    expect(parseMovedCallback(`mv_go_${RUN.date}_18:00`)).toEqual({
      action: "send",
      runDate: RUN.date,
      newStart: "18:00",
    });
    expect(parseMovedCallback("mv_no")).toEqual({ action: "cancel" });
  });

  it("не путаются с кнопками опроса и мусором", () => {
    expect(parseMovedCallback("crp_y_2026-09-05")).toBeNull();
    expect(parseMovedCallback("mv_go_2026-09-05")).toBeNull();
    expect(parseMovedCallback("")).toBeNull();
    expect(MOVED_CALLBACK_RE.test("optin_yes")).toBe(false);
  });

  it("влезают в лимит Telegram (64 байта)", () => {
    expect(Buffer.byteLength(`mv_go_${RUN.date}_18:00`)).toBeLessThanOrEqual(64);
  });
});

describe("отчёт о рассылке", () => {
  it("считает отправленные и предупреждает про остаток", () => {
    expect(noticeReportText({ sent: 29, blocked: 1, failed: 0 }, "перенос")).toContain("29");
    expect(noticeReportText({ sent: 60, hasMore: true }, "отмену")).toContain("повтори команду");
  });
});

describe("отмена забега", () => {
  const text = cancelText({ name: "Аня" }, RUN, "гроза");

  it("говорит про отмену в первой строке — её видно в превью чата", () => {
    const first = text.split("\n")[0];
    expect(first).toContain("отменяем");
    expect(first).toContain("Аня");
  });

  it("называет причину, забег и прямо говорит не приходить", () => {
    expect(text).toContain("Причина: гроза");
    expect(text).toContain(RUN.spotName);
    expect(text).toContain("Приходить не нужно");
  });

  it("без причины строку про причину не печатает", () => {
    expect(cancelText({ name: "Аня" }, RUN, null)).not.toContain("Причина");
  });

  it("не зовёт прийти позже: для переноса есть /moved", () => {
    expect(text).not.toContain("Сбор в");
    expect(text).not.toContain(RUN.gatherTime);
  });

  it("обещает сохранить место на следующем забеге", () => {
    expect(text).toContain("следующем забеге");
  });

  it("в кнопках нет маршрута и нет самого отменённого забега", () => {
    const kb = cancelKeyboard(RUN);
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels.join(" ")).not.toContain("Как добраться");
    expect(labels.some((l) => l.includes(RUN.dateLabel))).toBe(false);
  });

  it("предпросмотр предупреждает, что отозвать нельзя", () => {
    const preview = cancelPreviewText(RUN, "гроза", 35);
    expect(preview).toContain("ОТМЕНА");
    expect(preview).toContain("35 чел.");
    expect(preview).toContain("нельзя");
  });

  it("кнопки подтверждения разбираются обратно и не путаются с переносом", () => {
    const kb = cancelConfirmKeyboard(RUN.date);
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toContain(`cx_go_${RUN.date}`);

    expect(parseCancelCallback(`cx_go_${RUN.date}`)).toEqual({
      action: "send",
      runDate: RUN.date,
    });
    expect(parseCancelCallback("cx_no")).toEqual({ action: "cancel" });
    expect(parseCancelCallback("mv_no")).toBeNull();
    expect(CANCEL_CALLBACK_RE.test(`mv_go_${RUN.date}_18:00`)).toBe(false);
  });

  it("аргументы: дата и причина в любом порядке", () => {
    expect(parseCancelArgs("")).toEqual({ runDate: null, reason: null });
    expect(parseCancelArgs("гроза и ливень")).toEqual({
      runDate: null,
      reason: "гроза и ливень",
    });
    expect(parseCancelArgs("2026-09-06 гроза")).toEqual({
      runDate: "2026-09-06",
      reason: "гроза",
    });
  });
});
