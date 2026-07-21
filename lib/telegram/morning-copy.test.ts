import { describe, it, expect, afterEach } from "vitest";
import {
  MORNING_VARIANTS,
  pickVariant,
  buildMorningCta,
  buildMorningMessage,
  CHECKIN_PATH,
  MORNING_SRC,
  CTA_LABELS,
} from "./morning-copy";

const APP_URL = "https://www.mynika.online";
const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
});

describe("pickVariant — ротация формулировок", () => {
  it("никогда не повторяет прошлый вариант", () => {
    for (const prev of MORNING_VARIANTS.map((v) => v.variant)) {
      for (let i = 0; i < 200; i++) {
        expect(pickVariant(prev).variant).not.toBe(prev);
      }
    }
  });

  it("без прошлого варианта выбирает из всего пула", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickVariant().variant);
    expect(seen.size).toBe(MORNING_VARIANTS.length);
  });

  it("не падает, если прошлый вариант неизвестен", () => {
    expect(MORNING_VARIANTS).toContainEqual(pickVariant("нет-такого"));
  });
});

describe("тексты нуджа — приватность", () => {
  it("ни один текст не упоминает цикл/фазу/месячные/ПМС/овуляцию", () => {
    const forbidden = /цикл|фаз|месячн|менструац|пмс|овуляц/i;
    for (const v of MORNING_VARIANTS) expect(v.text).not.toMatch(forbidden);
  });

  it("максимум один эмодзи на текст", () => {
    const emoji = /\p{Extended_Pictographic}/gu;
    for (const v of MORNING_VARIANTS) {
      expect((v.text.match(emoji) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildMorningCta — одна URL-кнопка", () => {
  it("прямой диплинк на CHECKIN_PATH с src=tg_morning", () => {
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    const cta = buildMorningCta();
    expect(cta).toEqual({
      text: CTA_LABELS.primary,
      url: `${APP_URL}${CHECKIN_PATH}?src=${MORNING_SRC}`,
    });
  });

  it("использует готовую авто-логин ссылку, если передана", () => {
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    const magic = "https://www.mynika.online/api/tg/open?token_hash=abc&to=/rhythm&src=tg_morning";
    expect(buildMorningCta(magic)).toEqual({ text: CTA_LABELS.primary, url: magic });
  });

  it("при пустом NEXT_PUBLIC_APP_URL и без обёртки → null", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(buildMorningCta()).toBeNull();
  });
});

describe("buildMorningMessage — сборка сообщения", () => {
  it("текст + variant + ровно одна inline-кнопка", () => {
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    const msg = buildMorningMessage("user-1");
    expect(MORNING_VARIANTS.map((v) => v.variant)).toContain(msg.variant);
    expect(msg.text).toBe(MORNING_VARIANTS.find((v) => v.variant === msg.variant)?.text);
    expect(msg.reply_markup?.inline_keyboard).toHaveLength(1);
    expect(msg.reply_markup?.inline_keyboard[0]).toHaveLength(1);
    expect(msg.reply_markup?.inline_keyboard[0][0].url).toContain(`src=${MORNING_SRC}`);
  });

  it("при пустом NEXT_PUBLIC_APP_URL сообщение собирается без кнопки", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const msg = buildMorningMessage("user-1");
    expect(msg.text).toBeTruthy();
    expect(msg.reply_markup).toBeUndefined();
  });

  it("уважает ротацию: variant не равен прошлому", () => {
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    for (let i = 0; i < 100; i++) {
      expect(buildMorningMessage("user-1", "m2").variant).not.toBe("m2");
    }
  });
});
