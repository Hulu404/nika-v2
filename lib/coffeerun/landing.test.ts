import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { pacesForSpot } from "./pace";
import { COFFEE_RUNS, runForSignup, type CoffeeRun } from "./run";
import { fromRun } from "../landings/events";
import { renderTemplate } from "../landings/render";

/**
 * Связка «лендинг → забег»: с какой страницы пришла заявка, тот забег бот и
 * подтверждает. Тест читает сами страницы такими, какими их отдаёт сервер
 * (landings/<имя>.html + подстановка из run.ts, lib/landings/render.ts), а не
 * копию их кода: сломать связку можно только правкой страницы, и тогда падает
 * здесь, а не в личке участника.
 *
 * Лужники — самораспаковывающийся бандл: разметка лежит JSON-строкой в
 * <script type="__bundler/template"> (распаковка — scripts/coffeerun-landing.mjs).
 * Усачёва (/coffeerunsurfsport) — обычный HTML без бандлера: бандл показывал
 * «Unpacking...» и голый текст, пока распаковывался.
 */
const ROOT = path.join(__dirname, "..", "..");
const TEMPLATE_RE = /<script type="__bundler\/template"[^>]*>([\s\S]*?)<\/script>/;

function unbundle(html: string): string {
  const match = TEMPLATE_RE.exec(html);
  return match ? (JSON.parse(match[1]) as string) : html;
}

/** Страница забега, как её отдаёт сервер, когда этот забег — текущий. */
function landingSource(run: CoffeeRun): string {
  const name = run.landing.replace(/^\//, "");
  const html = readFileSync(path.join(ROOT, "landings", `${name}.html`), "utf8");
  return unbundle(renderTemplate(html, fromRun(run)));
}

/** Поле объекта EVENT, который сервер подставил в скрипт страницы. */
function eventField(source: string, name: string): unknown {
  const json = /var EVENT=(\{[^\n]*\});/.exec(source)?.[1];
  return json ? (JSON.parse(json) as Record<string, unknown>)[name] ?? null : null;
}

describe("лендинги кофе-рана — какой забег уезжает с формы", () => {
  it.each(COFFEE_RUNS.map((run) => [run.landing, run] as const))(
    "%s шлёт свой спот и свою дату",
    (_landing, run) => {
      const src = landingSource(run);

      expect(eventField(src, "spot")).toBe(run.spot);
      expect(eventField(src, "date")).toBe(run.date);
      expect(src).toContain("RUN_SPOT=EVENT.spot");
      expect(src).toContain("RUN_DATE=EVENT.date");

      // Константы должны реально уходить в запрос, а не просто лежать в файле.
      expect(src).toContain("spot:RUN_SPOT");
      expect(src).toContain("run_date:RUN_DATE");
      expect(src).toContain("/api/coffeerun-signup");
    },
  );

  it("заявка с каждой страницы разрешается в её же забег — день и адрес не путаются", () => {
    for (const run of COFFEE_RUNS) {
      const src = landingSource(run);
      const got = runForSignup({
        spot: eventField(src, "spot") as string,
        run_date: eventField(src, "date") as string,
      });

      expect(got.spot).toBe(run.spot);
      expect(got.weekday).toBe(run.weekday);
      expect(got.address).toBe(run.address);
    }
  });

  it("страница с устаревшей датой всё равно ведёт на свой спот, а не на соседний", () => {
    for (const run of COFFEE_RUNS) {
      // Закешированный лендинг присылает дату прошедшей волны регистраций.
      const got = runForSignup({ spot: run.spot, run_date: "2026-08-22" });
      expect(got.spot).toBe(run.spot);
      expect(got.address).toBe(run.address);
    }
  });

  it("на каждой странице стоят ровно те темпы, что знает сервер", () => {
    for (const run of COFFEE_RUNS) {
      const src = landingSource(run);

      // Значения кнопок — те же строки, что лягут в coffee_run_signups.pace:
      // разойдутся — сервер молча выбросит выбор человека (normalizePace → null).
      const values = [...src.matchAll(/name="pace"\s+value="([^"]+)"/g)].map((m) => m[1]);
      expect(values).toEqual(pacesForSpot(run.spot).map((p) => p.value));

      // Выбор должен реально уезжать в заявку, а не просто радовать глаз.
      expect(src).toContain("pace:pc");
    }
  });

  it("адрес страницы виден в её же разметке — вёрстка не разошлась с данными забега", () => {
    for (const run of COFFEE_RUNS) {
      const src = landingSource(run);
      // «Москва, ул. Усачёва, 62» → «ул. Усачёва, 62»: город в вёрстке не пишем.
      const street = run.address.replace(/^Москва,\s*/, "");
      expect(src).toContain(street);
      expect(src).toContain(run.dateLabel);
    }
  });

  it("/coffeerunsurfsport — обычный HTML: без бандлера, с согласием и реальной отправкой", () => {
    const html = readFileSync(path.join(ROOT, "landings", "coffeerunsurfsport.html"), "utf8");
    expect(html).not.toContain("__bundler");
    expect(html).toContain('id="i-ok"');
    expect(html).toContain("consent:true");
    expect(html).not.toContain("Демонстрация: заявка не отправлена");
    expect(html).not.toContain("Прототип: подтверждение в Telegram не отправляется");
    expect(html).toContain("https://www.mynika.online/legal/privacy");
  });

  it("/coffeerunsurfsport: номер забега из run.ts совпадает с разметкой во всех местах", () => {
    const run = COFFEE_RUNS.find((r) => r.landing === "/coffeerunsurfsport")!;
    const html = landingSource(run);
    expect(html).toContain("var RUN_EDITION=EVENT.edition;");
    const edition = Number(eventField(html, "edition"));
    expect(edition).toBeGreaterThan(0);
    const shown = [...html.matchAll(/data-edition>([^<]*)</g)].map((m) => m[1]);
    expect(shown.length).toBe(2);
    for (const text of shown) expect(text).toBe(`№ ${String(edition).padStart(3, "0")}`);
  });
});
