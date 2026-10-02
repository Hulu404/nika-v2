/**
 * Иконка NIKA (правка 04 брифа 2026-10-02): три варианта на сценах главного экрана.
 * Знак NIKA переводится в кривые из Playfair Display Regular (400), разрядка .08em,
 * ширина около 60% иконки, цвет #F4EFE6, без градиента, тени и свечения.
 *
 *   node scripts/app-icon/make-variants.cjs <PlayfairDisplay.ttf>
 * Нужен opentype.js (npm i opentype.js, вне зависимостей проекта).
 * Результат: scripts/app-icon/variants/icon-<сцена>.svg (мастер 1024×1024).
 */
const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");

const ROOT = path.resolve(__dirname, "../..");
const fontPath = process.argv[2];
if (!fontPath) throw new Error("укажи путь к PlayfairDisplay.ttf");
const font = opentype.loadSync(fontPath);

const SIZE = 1024;
const TEXT = "NIKA";
const TRACK = 0.08; // em
const TARGET_W = SIZE * 0.6;

// Контур знака: глифы по одному, с разрядкой между ними.
function wordmark(fontSize) {
  let x = 0;
  const parts = [];
  const glyphs = font.stringToGlyphs(TEXT);
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(x, 0, fontSize));
    x += (g.advanceWidth / font.unitsPerEm) * fontSize;
    if (i < glyphs.length - 1) x += TRACK * fontSize;
  });
  const p = new opentype.Path();
  parts.forEach((q) => q.commands.forEach((c) => p.commands.push(c)));
  return p;
}
let path0 = wordmark(100);
const b0 = path0.getBoundingBox();
const fontSize = (100 * TARGET_W) / (b0.x2 - b0.x1);
const mark = wordmark(fontSize);
const bb = mark.getBoundingBox();
const dx = (SIZE - (bb.x2 - bb.x1)) / 2 - bb.x1;
const dy = (SIZE - (bb.y2 - bb.y1)) / 2 - bb.y1;
const markPath = mark.toPathData(2);

// Сцены и градиенты берём из спрайта приложения, чтобы иконка совпадала с главной.
const html = fs.readFileSync(path.join(ROOT, "public/app/index.html"), "utf8");
const defs = html.slice(html.indexOf("<defs>", html.indexOf('<svg width="0" height="0"')), html.indexOf("</defs>") + 7);

const SCENES = {
  dawn: { id: "sc-dawn", y: 236, dim: 0.22 },
  dusk: { id: "sc-dusk", y: 236, dim: 0.22 },
  night: { id: "sc-night", y: 150, dim: 0.12 },
};

const outDir = path.join(__dirname, "variants");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, sc] of Object.entries(SCENES)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
${defs}
<svg x="0" y="0" width="${SIZE}" height="${SIZE}" viewBox="0 ${sc.y} 400 400" preserveAspectRatio="xMidYMid slice"><use href="#${sc.id}" xlink:href="#${sc.id}" width="400" height="800"/></svg>
<rect width="${SIZE}" height="${SIZE}" fill="rgba(11,11,13,${sc.dim})"/>
<path transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})" fill="#F4EFE6" d="${markPath}"/>
</svg>
`;
  fs.writeFileSync(path.join(outDir, `icon-${name}.svg`), svg);
  console.log("variant", name, (svg.length / 1024).toFixed(1) + " KB");
}
