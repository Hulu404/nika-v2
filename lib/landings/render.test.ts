import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COFFEE_RUNS } from "../coffeerun/run";
import { SESSIONS } from "../clubs/sessions";
import { LANDINGS, eventForLanding, fromRun, fromSession, upcomingEvents } from "./events";
import { escapeHtml, renderLanding, renderTemplate, scriptJson, shiftTime } from "./render";

const NAMES = Object.keys(LANDINGS);
const NOW = new Date("2026-11-11T12:00:00+03:00");

function source(name: string): string {
  return readFileSync(new URL(`../../landings/${name}.html`, import.meta.url), "utf8");
}

/** «1 ноября» не должно совпасть внутри «11 ноября» или «21 ноября». */
function hasLiteral(html: string, label: string): boolean {
  return new RegExp(`(^|[^0-9])${label}`).test(html);
}

describe("лендинги событий", () => {
  it("все пять лендингов на месте", () => {
    expect(NAMES.sort()).toEqual(["coffeerunluzhniki", "coffeerunsurfcave", "coffeerunsurfsport", "read", "stretch"]);
  });

  for (const name of NAMES) {
    describe(name, () => {
      const html = renderLanding(name, NOW);
      const event = eventForLanding(name, NOW)!;

      it("рендерится без единого {{", () => {
        expect(html).toBeTruthy();
        expect(html).not.toContain("{{");
      });

      it("показывает дату, время старта и адрес события", () => {
        expect(event).toBeTruthy();
        expect(html).toContain(escapeHtml(event.dateLabel));
        expect(html).toContain(event.startTime);
        expect(html).toContain(escapeHtml(event.address));
      });

      it("в исходнике нет даты, вписанной руками мимо плейсхолдера", () => {
        const raw = source(name);
        const labels = [...COFFEE_RUNS.map((r) => r.dateLabel), ...SESSIONS.map((s) => s.dateLabel)];
        for (const label of labels) {
          expect(hasLiteral(raw, label), `«${label}» в landings/${name}.html`).toBe(false);
        }
      });

      it("отдаёт в скрипт EVENT того же события", () => {
        const m = /EVENT\s*=\s*(\{[^;\n]*\});/.exec(html!.includes("__bundler/template") ? JSON.parse(/<script type="__bundler\/template"[^>]*>([\s\S]*?)<\/script>/.exec(html!)![1]) : html!);
        expect(m).toBeTruthy();
        const json = JSON.parse(m![1]);
        expect(json.date).toBe(event.date);
        expect(json.time).toBe(event.startTime);
        expect(json.source).toBe(name);
      });
    });
  }

  it("сдвиг старта двигает программу: перенос 12:30 → 13:00 на кофе-ране", () => {
    const run = COFFEE_RUNS.find((r) => r.landing === "/coffeerunsurfsport")!;
    const html = renderTemplate(source("coffeerunsurfsport"), fromRun({ ...run, gatherTime: "12:30", startTime: "13:00" }));
    expect(html).toContain("<dd>12:30 <small>старт 13:00</small></dd>");
    expect(html).toContain('<div class="t">≈13:40</div>');
    expect(html).not.toContain("≈13:10");
  });

  it("программа /stretch идёт от старта занятия", () => {
    const session = SESSIONS.find((s) => s.club === "stretch")!;
    const html = renderTemplate(source("stretch"), fromSession({ ...session, time: "12:30", gatherAt: "12:00" }));
    expect(html).toContain('<span class="t">12:40</span><span class="d">Основной');
    expect(html).toContain('<span class="t">13:20</span><span class="d">Заминка');
  });

  it("прошедший забег: страница берёт последний, а не падает", () => {
    const late = new Date("2030-01-01T12:00:00+03:00");
    for (const name of NAMES) expect(renderLanding(name, late)).not.toBeNull();
  });

  it("неизвестный лендинг — null", () => {
    expect(renderLanding("nope", NOW)).toBeNull();
  });
});

describe("shiftTime", () => {
  it("{{start+40}} при старте 12:30 даёт 13:10", () => {
    expect(shiftTime("12:30", 40)).toBe("13:10");
  });
  it("через полночь: 23:50 + 40 → 00:30", () => {
    expect(shiftTime("23:50", 40)).toBe("00:30");
  });
  it("назад: 0:10 − 20 → 23:50", () => {
    expect(shiftTime("0:10", -20)).toBe("23:50");
  });
});

describe("renderTemplate", () => {
  const base = fromRun(COFFEE_RUNS[0]);

  it("{{start+N}} и {{start-N}} в шаблоне", () => {
    const e = { ...base, startTime: "12:30" };
    expect(renderTemplate("{{start+40}} {{start-30}}", e)).toBe("13:10 12:00");
  });

  it("event_json с </script> в данных не закрывает тег", () => {
    const e = { ...base, dateLabel: "</script><script>alert(1)</script>" };
    const out = renderTemplate("<script>var EVENT={{event_json}};</script>", e);
    expect(out.match(/<\/script>/gi)).toHaveLength(1);
    expect(out).not.toContain("<script>alert");
    const json = JSON.parse(out.slice("<script>var EVENT=".length, out.lastIndexOf(";</script>")));
    expect(json.dateLabel).toBe("</script><script>alert(1)</script>");
  });

  it("значения в HTML экранируются", () => {
    const e = { ...base, address: `A & "B" <C>` };
    expect(renderTemplate("<b>{{address}}</b>", e)).toBe("<b>A &amp; &quot;B&quot; &lt;C&gt;</b>");
  });

  it("фильтры и производные поля даты", () => {
    const e = fromSession(SESSIONS.find((s) => s.club === "read")!);
    expect(renderTemplate("{{weekday|cap}} {{weekday_short}} {{date_dm}} {{date_en|upper}} {{edition|pad3}}", e)).toBe(
      `${e.weekday[0].toUpperCase()}${e.weekday.slice(1)} ЧТ 12.11 12 NOVEMBER 001`,
    );
  });

  it("опечатка в плейсхолдере — ошибка, а не тихая пустота", () => {
    expect(() => renderTemplate("{{date_lable}}", base)).toThrow(/date_lable/);
    expect(() => renderTemplate("{{weekday|shout}}", base)).toThrow(/shout/);
  });

  it("scriptJson экранирует <, > и &", () => {
    expect(scriptJson({ a: "<!-- & -->" })).toBe('{"a":"\\u003c!-- \\u0026 --\\u003e"}');
  });
});

describe("upcomingEvents", () => {
  it("забеги и занятия вместе, по дате и времени", () => {
    const list = upcomingEvents(NOW);
    const keys = list.map((e) => `${e.date} ${e.startTime.padStart(5, "0")}`);
    expect([...keys].sort()).toEqual(keys);
    expect(list.every((e) => e.date >= "2026-11-11")).toBe(true);
  });
});
