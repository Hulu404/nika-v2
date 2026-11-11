import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as copy from "../telegram/donation-copy";

/**
 * Тексты донатов совпадают с утверждённой таблицей брифа дословно, а в коде
 * донатов нет строк для человека мимо donation-copy.ts.
 */
describe("тексты поддержки клуба — дословно по таблице", () => {
  it.each([
    ["1 кнопка меню", copy.DONATE_MENU_LABEL, "🧡 Поддержать"],
    ["2 суммы", [copy.DONATION_AMOUNTS.map(copy.amountLabel), copy.CUSTOM_AMOUNT_LABEL].flat().join(" · "), "200 ₽ · 500 ₽ · 1000 ₽ · Своя сумма"],
    ["3 кнопка оплаты", copy.payLabel(350), "Оплатить 350 ₽"],
    ["4 экран", copy.DONATE_SCREEN_TEXT, "Многие встречи наших клубов бесплатные. Если хочешь поддержать нашу команду, будем очень признательны. Это добровольно 🤗"],
    ["5 своя сумма", copy.ASK_AMOUNT_TEXT, "Напиши сумму числом, от 100 ₽. Например: 300"],
    ["6 ошибка суммы", copy.BAD_AMOUNT_TEXT, "Нужно целое число от 100 до 50 000. Попробуешь ещё раз?"],
    ["7 почта", copy.ASK_EMAIL_TEXT, "Куда прислать чек? Напиши почту."],
    ["8 ошибка почты", copy.BAD_EMAIL_TEXT, "Похоже, в адресе опечатка. Проверь и пришли ещё раз."],
    ["9 после оплаты", copy.THANKS_TEXT, "Спасибо большое, получили 🧡 Чек уже на почте. Увидимся на следующей встрече!"],
    ["10 заголовок", copy.THANKS_PAGE.title, "Спасибо 🧡"],
    ["10 текст", copy.THANKS_PAGE.text, "Чек придёт на почту. Возвращайся в бот, там расписание ближайших встреч."],
    ["10 кнопка", copy.THANKS_PAGE.button, "Открыть бот"],
    ["11 не прошла", copy.PAYMENT_FAILED_TEXT, "Оплата не прошла. Можно попробовать ещё раз, кнопка ниже."],
    ["12 после события", copy.afterEventText("{event_prep}"), "Спасибо, что сегодня был(а) на {event_prep} 🧡 Нам важно, что ты пришёл(шла). Если хочешь, чтобы таких встреч было больше, можешь поддержать клуб, это добровольно 🤗"],
    ["13 мои записи", copy.SUPPORTER_LINE, "🧡 Ты поддерживаешь клуб"],
    ["14 описание платежа", copy.PAYMENT_DESCRIPTION, "Поддержка клуба NIKA"],
    ["15 предмет расчёта", copy.RECEIPT_ITEM, "Добровольная оплата участия в мероприятиях клуба NIKA"],
  ])("%s", (_n, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("{event_prep} по формату и запасной вариант", () => {
    expect(copy.eventPrep("coffeerun")).toBe("кофе-ране");
    expect(copy.eventPrep("pilates")).toBe("пилатесе");
    expect(copy.eventPrep("bookclub")).toBe("встрече книжного клуба");
    expect(copy.eventPrep("yoga")).toBe("нашей встрече");
  });

  it("суммы и границы", () => {
    expect([...copy.DONATION_AMOUNTS]).toEqual([200, 500, 1000]);
    expect([copy.DONATION_MIN_RUB, copy.DONATION_MAX_RUB]).toEqual([100, 50_000]);
  });

  it("сердечко везде оранжевое", () => {
    const src = readFileSync(new URL("../telegram/donation-copy.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/💛|❤️|♥/);
  });
});

describe("в коде донатов нет строк для человека мимо donation-copy.ts", () => {
  const FILES = [
    "../telegram/donations.ts",
    "../telegram/donation-keyboard.ts",
    "./payment.ts",
    "./process.ts",
    "./store.ts",
    "./rules.ts",
    "./after-event-dispatch.ts",
    "./webhook.ts",
    "../../app/thanks/page.tsx",
  ];

  it.each(FILES)("%s", (file) => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const offenders = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)) // комментарии
      .filter((line) => !/console\.(error|log|warn)|throw new Error|fail\(|must[<(]|reason:/.test(line)) // логи и ошибки для разработчика
      .filter((line) => /["'`][^"'`]*[А-Яа-яЁё][^"'`]*["'`]/.test(line));
    expect(offenders).toEqual([]);
  });

  it("ctx.reply в хендлерах — только с константами из donation-copy.ts или меню", () => {
    const src = readFileSync(new URL("../telegram/donations.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/ctx\.reply\(\s*["'`]/);
  });
});
