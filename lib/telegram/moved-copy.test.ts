import { describe, it, expect } from "vitest";
import {
  MOVED_CALLBACK_RE,
  gatherFor,
  movedConfirmKeyboard,
  movedPreviewText,
  movedReportText,
  movedText,
  parseMovedCallback,
  parseTime,
} from "./moved-copy";
import { parseMovedArgs } from "./coffeerun-moved";
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
    expect(movedReportText({ sent: 29, blocked: 1, failed: 0 })).toContain("29");
    expect(movedReportText({ sent: 60, hasMore: true })).toContain("повтори команду");
  });
});
