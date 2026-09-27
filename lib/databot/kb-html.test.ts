import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";
import { messageToKbHtml, sanitizeKbHtml } from "./kb-html";
import { SLUG_MAX, slugify, uniqueSlug } from "./slug";
import { isKbSlug } from "./validate";

describe("санитайзер статей", () => {
  it("разрешённые теги остаются", () => {
    expect(sanitizeKbHtml("<b>жирно</b> <i>курсив</i> <code>код</code>")).toBe("<b>жирно</b> <i>курсив</i> <code>код</code>");
    expect(sanitizeKbHtml('<a href="https://www.mynika.online/s/IGST">ссылка</a>')).toBe(
      '<a href="https://www.mynika.online/s/IGST">ссылка</a>',
    );
    expect(sanitizeKbHtml("<a href='tg://resolve?domain=nika'>бот</a>")).toBe('<a href="tg://resolve?domain=nika">бот</a>');
  });

  it("регистр тегов и пробелы внутри не мешают", () => {
    expect(sanitizeKbHtml("<B>да</ b>")).toBe("<b>да</b>");
  });

  it("прочие теги — экранируются, их видно в предпросмотре", () => {
    expect(sanitizeKbHtml("<u>подчёркнуто</u> <script>alert(1)</script>")).toBe(
      "&lt;u&gt;подчёркнуто&lt;/u&gt; &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("атрибуты вроде onclick у разрешённых тегов отбрасываются", () => {
    expect(sanitizeKbHtml('<b onclick="steal()">x</b>')).toBe("<b>x</b>");
    expect(sanitizeKbHtml('<a href="https://ok.ru" onclick="x()">y</a>')).toBe('<a href="https://ok.ru">y</a>');
  });

  it("javascript:, http:, data: и ссылки без href — тег убран, текст остался", () => {
    expect(sanitizeKbHtml('<a href="javascript:alert(1)">жми</a>')).toBe("жми");
    expect(sanitizeKbHtml('<a href="JaVaScRiPt:alert(1)">жми</a>')).toBe("жми");
    expect(sanitizeKbHtml('<a href="&#106;avascript:alert(1)">жми</a>')).toBe("жми");
    expect(sanitizeKbHtml('<a href="http://plain.ru">жми</a>')).toBe("жми");
    expect(sanitizeKbHtml('<a href="data:text/html,x">жми</a>')).toBe("жми");
    expect(sanitizeKbHtml("<a>жми</a>")).toBe("жми");
    expect(sanitizeKbHtml("<a href=https://no-quotes.ru>жми</a>")).toBe("жми");
  });

  it("незакрытые теги закрываются, лишние закрывающие выбрасываются", () => {
    expect(sanitizeKbHtml("<b>начало <i>вложенное")).toBe("<b>начало <i>вложенное</i></b>");
    expect(sanitizeKbHtml("текст</b> и </i>")).toBe("текст и ");
  });

  it("перекрёстная вложенность выправляется — Telegram её не принимает", () => {
    expect(sanitizeKbHtml("<b>1<i>2</b>3</i>")).toBe("<b>1<i>2</i></b>3");
  });

  it("вложенные разрешённые — как есть", () => {
    expect(sanitizeKbHtml("<b>жирный <i>и курсив</i></b>")).toBe("<b>жирный <i>и курсив</i></b>");
  });

  it("голые <, >, & экранируются, готовые сущности остаются", () => {
    expect(sanitizeKbHtml("3 < 5 & 7 > 2")).toBe("3 &lt; 5 &amp; 7 &gt; 2");
    expect(sanitizeKbHtml("уже &lt;тег&gt; и &amp;")).toBe("уже &lt;тег&gt; и &amp;");
  });

  it("кавычки в href не разрывают атрибут", () => {
    expect(sanitizeKbHtml(`<a href='https://x.ru/?q="1"'>y</a>`)).toBe('<a href="https://x.ru/?q=&quot;1&quot;">y</a>');
  });
});

describe("форматирование Telegram → HTML статьи", () => {
  const e = (type: string, offset: number, length: number, extra: object = {}) =>
    ({ type, offset, length, ...extra }) as MessageEntity;

  it("жирный, курсив, код и ссылка", () => {
    const text = "Жирно курсив код тут";
    expect(
      messageToKbHtml(text, [e("bold", 0, 5), e("italic", 6, 6), e("code", 13, 3), e("text_link", 17, 3, { url: "https://www.mynika.online" })]),
    ).toBe('<b>Жирно</b> <i>курсив</i> <code>код</code> <a href="https://www.mynika.online">тут</a>');
  });

  it("вложенные сущности — вложенные теги", () => {
    expect(messageToKbHtml("abc", [e("bold", 0, 3), e("italic", 1, 1)])).toBe("<b>a<i>b</i>c</b>");
  });

  it("небезопасная ссылка из сущности вычищается, текст экранируется", () => {
    expect(messageToKbHtml("x <y>", [e("text_link", 0, 1, { url: "http://evil.ru" })])).toBe("x &lt;y&gt;");
  });

  it("без форматирования — текст как HTML, набранный руками", () => {
    expect(messageToKbHtml("<b>да</b> <u>нет</u>", undefined)).toBe("<b>да</b> &lt;u&gt;нет&lt;/u&gt;");
  });

  it("эмодзи (суррогатные пары) не сбивают смещения", () => {
    expect(messageToKbHtml("🏃 бег", [e("bold", 3, 3)])).toBe("🏃 <b>бег</b>");
  });
});

describe("slug статьи", () => {
  it("транслит заголовка под ^[a-z0-9-]{2,40}$", () => {
    expect(slugify("Строка цифр кофе-рана")).toBe("stroka-tsifr-kofe-rana");
    expect(slugify("Кто за что отвечает (октябрь)")).toBe("kto-za-chto-otvechaet-oktyabr");
    expect(slugify("Ёлка и щука")).toBe("elka-i-schuka");
    expect(slugify("!!!")).toBe("statya");
    const long = slugify("Очень длинный заголовок статьи справочника про всё сразу и ещё немного");
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(isKbSlug(long)).toBe(true);
  });

  it("занят — -2, -3, в пределах 40 знаков", () => {
    expect(uniqueSlug("Метки", new Set(["metki"]))).toBe("metki-2");
    expect(uniqueSlug("Метки", new Set(["metki", "metki-2"]))).toBe("metki-3");
    const base = "a".repeat(40);
    const next = uniqueSlug(base, new Set([base]));
    expect(next.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(next.endsWith("-2")).toBe(true);
    expect(isKbSlug(next)).toBe(true);
  });
});
