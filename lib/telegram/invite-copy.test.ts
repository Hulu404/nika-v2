import { describe, it, expect } from "vitest";
import {
  INVITE_CALLBACK_RE,
  inviteConfirmKeyboard,
  invitePreviewText,
  inviteReportText,
  inviteText,
  parseInviteCallback,
} from "./invite-copy";
import { parseOpenArgs } from "./coffeerun-invite";
import type { CoffeeRun } from "../coffeerun/run";

const RUN: CoffeeRun = {
  spot: "luzhniki",
  landing: "/coffeerunluzhniki",
  spotName: "Surf Coffee® Лужники",
  date: "2026-09-20",
  dateLabel: "20 сентября",
  weekday: "воскресенье",
  gatherTime: "9:30",
  startTime: "10:00",
  address: "Москва, ул. Лужники, 24, стр. 41",
  place: "спот Surf Coffee Лужники",
  distance: "5 км",
  mapUrl: "https://yandex.ru/maps/?text=luzhniki",
};

describe("inviteText — сообщение участнику", () => {
  const text = inviteText({ name: "Аня" }, RUN);

  it("обращается по имени из заявки", () => {
    expect(text.startsWith("Аня, ")).toBe(true);
  });

  it("называет спот, дату и время — решение принимается из превью чата", () => {
    expect(text).toContain(RUN.spotName);
    expect(text).toContain(RUN.dateLabel);
    expect(text).toContain(RUN.weekday);
    expect(text).toContain(RUN.startTime);
    expect(text).toContain(RUN.address);
  });

  it("называет отписку — рассылка, из которой нельзя уйти, это спам", () => {
    expect(text).toContain("/stop");
  });

  it("зовёт записаться, а не просто сообщает", () => {
    expect(text).toMatch(/заявк/i);
  });
});

describe("invitePreviewText — что видит организатор до отправки", () => {
  it("показывает ровно тот текст, который уйдёт людям", () => {
    const preview = invitePreviewText(RUN, 42, {
      alreadyInvited: 0,
      optedOut: 0,
      registered: 0,
    });
    expect(preview).toContain(inviteText({ name: "Имя" }, RUN));
    expect(preview).toContain("42");
    expect(preview).toContain("Отправляем?");
  });

  it("перечисляет, кого пропустили и почему", () => {
    const preview = invitePreviewText(RUN, 10, {
      alreadyInvited: 3,
      optedOut: 2,
      registered: 1,
    });
    expect(preview).toContain("уже звали: 3");
    expect(preview).toContain("уже записаны: 1");
    expect(preview).toContain("просили не писать: 2");
  });

  it("про пропущенных молчит, когда пропускать некого", () => {
    const preview = invitePreviewText(RUN, 10, {
      alreadyInvited: 0,
      optedOut: 0,
      registered: 0,
    });
    expect(preview).not.toContain("Пропускаю");
  });
});

describe("callback_data подтверждения", () => {
  it("кнопка «Разослать» переживает round-trip", () => {
    const kb = inviteConfirmKeyboard(RUN.spot, RUN.date);
    const data = kb.inline_keyboard[0][0];
    expect("callback_data" in data && data.callback_data).toBe("op_go_luzhniki_2026-09-20");

    const parsed = parseInviteCallback(`op_go_${RUN.spot}_${RUN.date}`);
    expect(parsed).toEqual({ action: "send", spot: "luzhniki", runDate: "2026-09-20" });
  });

  it("слаг спота с подчёркиванием не рвёт разбор — дату режем с конца", () => {
    expect(parseInviteCallback("op_go_surf_sport_2026-09-19")).toEqual({
      action: "send",
      spot: "surf_sport",
      runDate: "2026-09-19",
    });
  });

  it("«Отмена» распознаётся отдельно", () => {
    expect(parseInviteCallback("op_no")).toEqual({ action: "cancel" });
  });

  it("чужие данные не наши — null, а не выдуманный забег", () => {
    for (const data of ["", "mv_no", "cx_go_2026-09-20", "op_go_luzhniki", "op_go_luzhniki_вчера"]) {
      expect(parseInviteCallback(data)).toBeNull();
    }
  });

  it("регулярка ловит ровно свои данные", () => {
    expect(INVITE_CALLBACK_RE.test("op_no")).toBe(true);
    expect(INVITE_CALLBACK_RE.test("op_go_luzhniki_2026-09-20")).toBe(true);
    expect(INVITE_CALLBACK_RE.test("mv_go_2026-09-20_18:00")).toBe(false);
  });
});

describe("parseOpenArgs — аргументы /open", () => {
  const spots = ["usachevo", "luzhniki"];

  it("пустой аргумент — ближайший забег", () => {
    expect(parseOpenArgs("", spots)).toEqual({ runDate: null, spot: null });
  });

  it("узнаёт спот по слагу, регистр не важен", () => {
    expect(parseOpenArgs("luzhniki", spots)).toEqual({ runDate: null, spot: "luzhniki" });
    expect(parseOpenArgs("LUZHNIKI", spots)).toEqual({ runDate: null, spot: "luzhniki" });
  });

  it("узнаёт дату по формату", () => {
    expect(parseOpenArgs("2026-09-20", spots)).toEqual({
      runDate: "2026-09-20",
      spot: null,
    });
  });

  it("порядок аргументов свободный", () => {
    expect(parseOpenArgs("2026-09-20 luzhniki", spots)).toEqual({
      runDate: "2026-09-20",
      spot: "luzhniki",
    });
    expect(parseOpenArgs("luzhniki 2026-09-20", spots)).toEqual({
      runDate: "2026-09-20",
      spot: "luzhniki",
    });
  });

  it("незнакомый спот не превращается в забег молча", () => {
    expect(parseOpenArgs("kazan", spots)).toEqual({ runDate: null, spot: null });
  });
});

describe("inviteReportText", () => {
  it("считает отправленные, заблокировавших и недошедшие", () => {
    expect(inviteReportText({ sent: 5, blocked: 1, failed: 2 })).toBe(
      "Разослала приглашение: 5. Заблокировали бота: 1. Не дошло: 2.",
    );
  });

  it("про остаток говорит прямо — иначе половина людей молча не получит", () => {
    expect(inviteReportText({ sent: 60, hasMore: true })).toContain("повтори /open");
  });
});
