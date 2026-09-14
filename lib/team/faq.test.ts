import { describe, it, expect } from "vitest";
import { FAQ, NEEDS_APPROVAL, faqAnswerText, faqIndexText, findFaq } from "./faq";

/**
 * Справочник быстрых ответов проверяется на два свойства: он находится по
 * человеческим словам и он не врёт актуальным расписанием. Тексты ответов
 * специально НЕ фиксируем дословно — они правятся чаще, чем этот файл.
 */

describe("устройство справочника", () => {
  it("ключи уникальны — иначе /faq <ключ> отдаст первый попавшийся", () => {
    const keys = FAQ.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("у каждого пункта есть по чему искать", () => {
    for (const e of FAQ) {
      expect(e.keywords.length, `${e.key}: нет ключевых слов`).toBeGreaterThan(0);
      // Ключевые слова ищутся по строке в нижнем регистре — верхний не найдётся
      // никогда, и это самый тихий способ сломать поиск.
      expect(e.keywords.every((k) => k === k.toLowerCase()), `${e.key}: верхний регистр`).toBe(true);
    }
  });

  it("оглавление показывает и то, что говорить нельзя", () => {
    const index = faqIndexText();
    for (const e of FAQ) expect(index).toContain(`/faq ${e.key}`);
    for (const n of NEEDS_APPROVAL) expect(index).toContain(n);
  });
});

describe("findFaq", () => {
  it("находит по точному ключу", () => {
    expect(findFaq("pace").map((e) => e.key)).toEqual(["pace"]);
  });

  it("находит по тому, как вопрос звучит вживую", () => {
    expect(findFaq("какой темп?").map((e) => e.key)).toContain("pace");
    expect(findFaq("почему не пришло напоминание").map((e) => e.key)).toContain("reminder");
    expect(findFaq("человек хочет отписаться").map((e) => e.key)).toContain("stop");
  });

  it("огрызок не вываливает весь справочник", () => {
    // «а» встречается в половине ключевых слов. Раньше это давало «нашла
    // несколько» со списком из десяти пунктов вместо ответа.
    expect(findFaq("а").length).toBeLessThan(FAQ.length);
    expect(findFaq("")).toEqual([]);
  });

  it("незнакомое — пусто, а не «ближайшее по духу»", () => {
    // Уверенно сказанный неверный ответ здесь хуже честного «не знаю»:
    // человек из команды перескажет его участнику как факт.
    expect(findFaq("а можно с собакой")).toEqual([]);
  });
});

describe("ответы", () => {
  it("расписание берётся из run.ts, а не из текста ответа", () => {
    // Момент до забегов сезона 2026: ответ про «когда» обязан назвать спот,
    // а не заготовленную дату.
    const when = FAQ.find((e) => e.key === "when")!;
    const text = faqAnswerText(when, new Date("2026-09-15T09:00:00Z"));
    expect(text).toContain("Surf Coffee");
  });

  it("сезон кончился — так и говорим, а не показываем прошлогодний забег", () => {
    const when = FAQ.find((e) => e.key === "when")!;
    expect(faqAnswerText(when, new Date("2030-01-01T00:00:00Z"))).toContain(
      "Ближайших забегов в расписании нет",
    );
  });

  it("про перенос и отмену отправляет в основной бот, а не берётся решать", () => {
    const moved = FAQ.find((e) => e.key === "moved")!;
    const text = faqAnswerText(moved, new Date("2026-09-15T09:00:00Z"));
    expect(text).toContain("ОСНОВНОМ боте");
    expect(text).toContain("решение организатора");
  });

  it("каждый ответ переживает пустое расписание", () => {
    // Межсезонье — не повод падать посреди разговора с участником.
    for (const e of FAQ) {
      expect(() => faqAnswerText(e, new Date("2030-01-01T00:00:00Z")), e.key).not.toThrow();
    }
  });
});
