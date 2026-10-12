import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { COFFEE_RUN_PACES } from "./pace";
import { COFFEE_RUNS, runForSignup } from "./run";

/**
 * Связка «лендинг → забег»: с какой страницы пришла заявка, тот забег бот и
 * подтверждает. Тест читает сами бандлы, а не копию их кода: сломать её можно
 * только правкой страницы, и тогда падает здесь, а не в личке участника.
 *
 * Лужники — самораспаковывающийся бандл: разметка лежит JSON-строкой в
 * <script type="__bundler/template"> (распаковка — scripts/coffeerun-landing.mjs).
 * Усачёва (/coffeerunsurfsport) — обычный HTML без бандлера: бандл показывал
 * «Unpacking...» и голый текст, пока распаковывался.
 */
const ROOT = path.join(__dirname, "..", "..");
const TEMPLATE_RE = /<script type="__bundler\/template"[^>]*>([\s\S]*?)<\/script>/;

function landingSource(landing: string): string {
  const file = path.join(ROOT, "public", landing.replace(/^\//, ""), "index.html");
  const html = readFileSync(file, "utf8");
  const match = TEMPLATE_RE.exec(html);
  return match ? (JSON.parse(match[1]) as string) : html;
}

/** Значение JS-константы вида `var RUN_SPOT='luzhniki', ...` со страницы. */
function constant(source: string, name: string): string | null {
  return new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(source)?.[1] ?? null;
}

describe("лендинги кофе-рана — какой забег уезжает с формы", () => {
  it.each(COFFEE_RUNS.map((run) => [run.landing, run] as const))(
    "%s шлёт свой спот и свою дату",
    (_landing, run) => {
      const src = landingSource(run.landing);

      expect(constant(src, "RUN_SPOT")).toBe(run.spot);
      expect(constant(src, "RUN_DATE")).toBe(run.date);

      // Константы должны реально уходить в запрос, а не просто лежать в файле.
      expect(src).toContain("spot:RUN_SPOT");
      expect(src).toContain("run_date:RUN_DATE");
      expect(src).toContain("/api/coffeerun-signup");
    },
  );

  it("заявка с каждой страницы разрешается в её же забег — день и адрес не путаются", () => {
    for (const run of COFFEE_RUNS) {
      const src = landingSource(run.landing);
      const got = runForSignup({
        spot: constant(src, "RUN_SPOT"),
        run_date: constant(src, "RUN_DATE"),
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
      const src = landingSource(run.landing);

      // Значения кнопок — те же строки, что лягут в coffee_run_signups.pace:
      // разойдутся — сервер молча выбросит выбор человека (normalizePace → null).
      const values = [...src.matchAll(/name="pace"\s+value="([^"]+)"/g)].map((m) => m[1]);
      expect(values).toEqual(COFFEE_RUN_PACES.map((p) => p.value));

      // Выбор должен реально уезжать в заявку, а не просто радовать глаз.
      expect(src).toContain("pace:pc");
    }
  });

  it("адрес страницы виден в её же разметке — вёрстка не разошлась с данными забега", () => {
    for (const run of COFFEE_RUNS) {
      const src = landingSource(run.landing);
      // «Москва, ул. Усачёва, 62» → «ул. Усачёва, 62»: город в вёрстке не пишем.
      const street = run.address.replace(/^Москва,\s*/, "");
      expect(src).toContain(street);
      expect(src).toContain(run.dateLabel);
    }
  });

  it("/coffeerunsurfsport — обычный HTML: без бандлера, с согласием и реальной отправкой", () => {
    const html = readFileSync(path.join(ROOT, "public", "coffeerunsurfsport", "index.html"), "utf8");
    expect(html).not.toContain("__bundler");
    expect(html).toContain('id="i-ok"');
    expect(html).toContain("consent:true");
    expect(html).not.toContain("Демонстрация: заявка не отправлена");
    expect(html).not.toContain("Прототип: подтверждение в Telegram не отправляется");
    expect(html).toContain("https://www.mynika.online/legal/privacy");
  });

  it("/coffeerunsurfsport: номер забега из RUN_EDITION совпадает с разметкой во всех местах", () => {
    const html = readFileSync(path.join(ROOT, "public", "coffeerunsurfsport", "index.html"), "utf8");
    const edition = Number(/var RUN_EDITION=(\d+);/.exec(html)?.[1]);
    expect(edition).toBeGreaterThan(0);
    const shown = [...html.matchAll(/data-edition>([^<]*)</g)].map((m) => m[1]);
    expect(shown.length).toBe(2);
    for (const text of shown) expect(text).toBe(`№ ${String(edition).padStart(3, "0")}`);
  });
});
