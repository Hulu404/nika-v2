import { describe, it, expect } from "vitest";
import {
  CHECKIN_VARIANTS,
  ANSWER_CODES,
  SCALE_TO_ANSWER,
  pickVariant,
} from "./checkin-copy";

describe("банк вопросов чек-ина", () => {
  it("НИКОГДА не упоминает цикл/фазу/месячные — ни в одном варианте", () => {
    const forbidden = /цикл|фаз|месячн|менстру|овуляц|пмс/i;
    for (const v of CHECKIN_VARIANTS) {
      expect(forbidden.test(v.text), `вариант ${v.variant}: "${v.text}"`).toBe(false);
    }
  });

  it("ротация не повторяет прошлый вариант подряд", () => {
    for (const last of CHECKIN_VARIANTS.map((v) => v.variant)) {
      for (let i = 0; i < 50; i++) {
        expect(pickVariant(last).variant).not.toBe(last);
      }
    }
  });

  it("без прошлого варианта всё равно возвращает валидный вариант", () => {
    const known = new Set(CHECKIN_VARIANTS.map((v) => v.variant));
    for (let i = 0; i < 20; i++) {
      expect(known.has(pickVariant().variant)).toBe(true);
    }
  });

  it("шкала 1–5 маппится в answer-enum (1–2→bad/tired, 3→ok, 4–5→full)", () => {
    expect(SCALE_TO_ANSWER.ans_1).toBe("bad");
    expect(SCALE_TO_ANSWER.ans_2).toBe("tired");
    expect(SCALE_TO_ANSWER.ans_3).toBe("ok");
    expect(SCALE_TO_ANSWER.ans_4).toBe("full");
    expect(SCALE_TO_ANSWER.ans_5).toBe("full");
  });

  it("все answer-коды резолвятся в валидный enum", () => {
    const valid = new Set(["full", "ok", "tired", "bad"]);
    for (const [code, answer] of Object.entries(ANSWER_CODES)) {
      expect(valid.has(answer), `код ${code}`).toBe(true);
    }
  });
});
