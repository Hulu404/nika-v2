/**
 * Комплект иконок NIKA из одного SVG-мастера (правка 04). Запускать после выбора варианта:
 *   node scripts/app-icon/build-icons.cjs <dawn|dusk|night>
 * Нужен playwright с Chromium (вне зависимостей проекта): npm i playwright && npx playwright install chromium
 * Пишет в public/app/icons/: apple-touch-icon.png (180), icon-192.png, icon-512.png,
 * maskable-512.png (знак внутри безопасной зоны 80%), favicon-32.png, icon-1024.png (для сторов),
 * icon.svg (мастер). Все без прозрачности.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const variant = process.argv[2];
const src = path.join(__dirname, "variants", `icon-${variant}.svg`);
if (!fs.existsSync(src)) throw new Error("нет варианта: " + variant);
const OUT = path.resolve(__dirname, "../../public/app/icons");
const master = fs.readFileSync(src, "utf8");

// maskable: сцена на весь квадрат, знак уменьшен до 80%, чтобы круглая маска Android его не срезала
const maskable = master.replace(/<path transform="translate\(([-\d.]+) ([-\d.]+)\)"/, (m, x, y) =>
  `<path transform="translate(512 512) scale(0.8) translate(-512 -512) translate(${x} ${y})"`);

const SIZES = [
  ["apple-touch-icon.png", 180, master],
  ["icon-192.png", 192, master],
  ["icon-512.png", 512, master],
  ["maskable-512.png", 512, maskable],
  ["favicon-32.png", 32, master],
  ["icon-1024.png", 1024, master],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, svg] of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    const uri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    await page.setContent(`<html><body style="margin:0;background:#0B0B0D"><img src="${uri}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: false });
    console.log(file, size);
  }
  fs.writeFileSync(path.join(OUT, "icon.svg"), master);
  await browser.close();
})();
