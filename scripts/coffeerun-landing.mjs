/**
 * Распаковка и запаковка лендингов кофе-рана.
 *
 * Файлы public/coffeerun<спот>/index.html — не обычные страницы, а самораспаковывающиеся
 * бандлы: шрифты лежат в <script type="__bundler/manifest">, а вся разметка —
 * одной JSON-строкой в <script type="__bundler/template">. Править файл
 * напрямую почти всегда значит промахнуться мимо экранирования, поэтому:
 *
 *   node scripts/coffeerun-landing.mjs extract luzhniki page.html   # достать разметку
 *   …правим page.html как обычный HTML…
 *   node scripts/coffeerun-landing.mjs pack    luzhniki page.html   # вернуть обратно
 *
 * Так же вставляется схема маршрута на странице Лужников: в page.html заменить
 * блок .map-blank на <img src="data:image/…;base64,…"> и запаковать обратно.
 * Внешние файлы не годятся — рядом с бандлом их просто нет, только data-URI.
 *
 * pack проверяет себя: распаковывает записанное обратно и сверяет с исходником.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TEMPLATE_RE = /(<script type="__bundler\/template"[^>]*>)([\s\S]*?)(<\/script>)/;

const [, , cmd, spot, file] = process.argv;

if (!["extract", "pack"].includes(cmd) || !spot || !file) {
  console.error("использование: node scripts/coffeerun-landing.mjs <extract|pack> <spot> <file>");
  console.error("  spot — кусок пути лендинга: surfsport | luzhniki");
  process.exit(1);
}

const bundlePath = `public/coffeerun${spot}/index.html`;
const bundle = readFileSync(bundlePath, "utf8");
const match = TEMPLATE_RE.exec(bundle);
if (!match) throw new Error(`в ${bundlePath} нет <script type="__bundler/template">`);

if (cmd === "extract") {
  writeFileSync(file, JSON.parse(match[2]));
  console.log(`${bundlePath} → ${file}`);
  process.exit(0);
}

const template = readFileSync(file, "utf8");
// Экранирование `</` обязательно: без него первый же </div> внутри JSON-строки
// закроет сам <script> и страница развалится.
const encoded = JSON.stringify(template).replace(/<\//g, "<\\u002F");
const out = bundle.replace(TEMPLATE_RE, (_m, open, _json, close) => open + encoded + close);

writeFileSync(bundlePath, out);

const back = JSON.parse(TEMPLATE_RE.exec(readFileSync(bundlePath, "utf8"))[2]);
if (back !== template) throw new Error("round-trip не сошёлся — бандл повреждён, откатите файл");

console.log(`${file} → ${bundlePath} (${Math.round(out.length / 1024)} КБ)`);
