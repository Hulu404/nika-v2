import { describe, it, expect } from "vitest";
import { resolveRecommendationCategory, RECO_TEXT } from "./recommend";

describe("рекомендация по ответу чек-ина", () => {
  it("tired/bad → отдых; ok → база; full → прибавить", () => {
    expect(resolveRecommendationCategory("tired", null)).toBe("rest");
    expect(resolveRecommendationCategory("bad", null)).toBe("rest");
    expect(resolveRecommendationCategory("ok", null)).toBe("base");
    expect(resolveRecommendationCategory("full", null)).toBe("more");
  });

  it("субъективный ответ ПРИОРИТЕТНЕЕ фазы (конфликт → побеждает ответ)", () => {
    // фаза говорит «низкая энергия», а ответ full → всё равно «можно прибавить»
    expect(resolveRecommendationCategory("full", "low")).toBe("more");
    // фаза «высокая», а ответ bad → всё равно отдых
    expect(resolveRecommendationCategory("bad", "high")).toBe("rest");
    expect(resolveRecommendationCategory("ok", "high")).toBe("base");
  });

  it("без ответа (слабый сигнал) — дефолт по фазе", () => {
    expect(resolveRecommendationCategory(null, "low")).toBe("rest");
    expect(resolveRecommendationCategory(null, "high")).toBe("more");
    expect(resolveRecommendationCategory(null, "normal")).toBe("base");
    expect(resolveRecommendationCategory(null, null)).toBe("base");
  });

  it("ни один текст рекомендации не упоминает цикл/фазу/месячные", () => {
    const forbidden = /цикл|фаз|месячн|менстру|овуляц|пмс/i;
    for (const [cat, text] of Object.entries(RECO_TEXT)) {
      expect(forbidden.test(text), `${cat}: "${text}"`).toBe(false);
    }
  });
});
