import { describe, it, expect, afterEach } from "vitest";
import {
  CLUB_SURVEYS,
  ORIGIN_FALLBACK,
  activeSurvey,
  consentUrl,
  surveyByKey,
  surveyByStartPayload,
  surveyStartLink,
} from "./survey-config";

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("CLUB_SURVEYS — конфиг опросов", () => {
  it.each(CLUB_SURVEYS.map((s) => [s.key, s] as const))(
    "%s: ключ и payload влезают в callback_data и deep-link",
    (_key, survey) => {
      expect(survey.key).toMatch(/^[a-z0-9]{1,12}$/);
      expect(survey.startPayload).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      // Payload опроса не должен выглядеть как deep-link кофе-рана.
      expect(survey.startPayload.startsWith("cr_")).toBe(false);
    },
  );

  it.each(CLUB_SURVEYS.map((s) => [s.key, s] as const))(
    "%s: подпись каждого дня совпадает с его датой",
    (_key, survey) => {
      for (const day of survey.days) {
        const d = new Date(`${day.date}T00:00:00Z`);
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        expect(day.label).toBe(`${WEEKDAY_SHORT[d.getUTCDay()]} ${dd}.${mm}`);
      }
    },
  );

  it.each(CLUB_SURVEYS.map((s) => [s.key, s] as const))(
    "%s: дни по порядку, без повторов, напоминаем раньше первого дня",
    (_key, survey) => {
      const dates = survey.days.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
      expect(new Set(dates).size).toBe(dates.length);
      expect(new Date(survey.reminderDeadline).getTime()).toBeLessThan(
        new Date(`${dates[0]}T00:00:00+03:00`).getTime(),
      );
    },
  );

  it.each(CLUB_SURVEYS.map((s) => [s.key, s] as const))(
    "%s: окна и границы дня осмысленны",
    (_key, survey) => {
      for (const w of [survey.reminderWindow, survey.eveWindow]) {
        expect(w.fromHour).toBeGreaterThanOrEqual(0);
        expect(w.toHour).toBeLessThanOrEqual(24);
        expect(w.fromHour).toBeLessThan(w.toHour);
      }
      expect(survey.dayFrom).toMatch(HHMM);
      expect(survey.dayTo).toMatch(HHMM);
      expect(survey.dayFrom < survey.dayTo).toBe(true);
      expect(survey.sessionMinutes).toBeGreaterThan(0);
    },
  );

  it("ключи и payload уникальны", () => {
    expect(new Set(CLUB_SURVEYS.map((s) => s.key)).size).toBe(CLUB_SURVEYS.length);
    expect(new Set(CLUB_SURVEYS.map((s) => s.startPayload)).size).toBe(CLUB_SURVEYS.length);
  });
});

describe("опрос йоги — значения из docs/club-survey.md", () => {
  const yoga = surveyByKey("yoga");

  it("находится по ключу и по payload, чужое не находит", () => {
    expect(yoga).not.toBeNull();
    expect(surveyByStartPayload("yoga")).toBe(yoga);
    expect(surveyByStartPayload("cr_abc")).toBeNull();
    expect(surveyByStartPayload("")).toBeNull();
    expect(surveyByKey("nope")).toBeNull();
    expect(activeSurvey()).toBe(yoga);
  });

  it("пять дней с 28.10 по 01.11 и подписи для текстов", () => {
    expect(yoga?.days.map((d) => d.label)).toEqual([
      "Ср 28.10",
      "Чт 29.10",
      "Пт 30.10",
      "Сб 31.10",
      "Вс 01.11",
    ]);
    expect(yoga?.weekLabel).toBe("с 28 октября по 1 ноября");
    expect(yoga?.resultLabel).toBe("в пятницу, 23 октября");
    expect(yoga?.voteDeadlineLabel).toBe("до четверга");
  });

  it("срок, окна и длительность", () => {
    expect(new Date(yoga!.reminderDeadline).toISOString()).toBe("2026-10-22T09:00:00.000Z");
    expect(yoga?.reminderDelayHours).toBe(24);
    expect(yoga?.reminderWindow).toEqual({ fromHour: 10, toHour: 21 });
    expect(yoga?.eveWindow).toEqual({ fromHour: 18, toHour: 21 });
    expect(yoga?.sessionMinutes).toBe(60);
    expect([yoga?.dayFrom, yoga?.dayTo]).toEqual(["07:00", "23:00"]);
  });
});

describe("ссылки", () => {
  it("согласие — от NEXT_PUBLIC_APP_URL, хвост пути отрезается", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.mynika.online/api/telegram/webhook";
    expect(consentUrl()).toBe("https://www.mynika.online/legal/consent");
  });

  it("согласие без NEXT_PUBLIC_APP_URL — запасной origin", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(consentUrl()).toBe(`${ORIGIN_FALLBACK}/legal/consent`);
  });

  it("ссылка для поста собирается из имени бота, с @ и без", () => {
    const yoga = surveyByKey("yoga")!;
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "@mynikarun_bot";
    expect(surveyStartLink(yoga)).toBe("https://t.me/mynikarun_bot?start=yoga");
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "";
    expect(surveyStartLink(yoga)).toBeNull();
  });
});
