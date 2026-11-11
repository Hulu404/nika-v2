import type { LandingEvent } from "./events";

/**
 * Подстановка данных события в шаблон лендинга — чистая часть, без node:fs.
 * Её же читает бот (lib/telegram/menu.ts), а бот попадает и в edge-сборку
 * (instrumentation → ensure-webhook), где node:fs нет. Чтение файлов —
 * lib/landings/render.ts.
 *
 * Лендинги событий собираются на сервере: HTML лежит в landings/<имя>.html с
 * плейсхолдерами {{…}}, а дата, время и адрес подставляются из lib/coffeerun/
 * run.ts и lib/clubs/sessions.ts при каждой отдаче. Сервер, а не JS в браузере:
 * превью ссылки в Telegram и поисковики читают <title> и og-теги без скриптов.
 *
 * Плейсхолдеры:
 *   {{date_label}} «15 ноября»   {{weekday}} «воскресенье»   {{weekday_short}} «ВС»
 *   {{weekday_acc}} «(в) воскресенье / среду»   {{weekday_this}} «этот четверг / эту среду»   {{date_iso}} «2026-11-15»   {{year}}
 *   {{date_dm}} «15.11»   {{date_dmy}} «15.11.2026»   {{date_en}} «15 November»
 *   {{weekday_en}} «Sunday»
 *   {{gather_time}} {{start_time}}   {{start+N}} / {{start-N}} — старт ± N минут
 *   {{address}} полный, {{address_short}} без «Москва, »   {{place}} {{metro}}
 *   {{map_url}} {{edition}} {{price_rub}} {{spot}}
 *   {{event_json}} — объект EVENT для скрипта страницы (без HTML-экранирования,
 *   но с защитой от </script>).
 *
 * Фильтры через «|»: upper, lower, cap (первая буква заглавная), pad3 (8 → 008).
 * Например {{weekday|cap}}, {{date_en|upper}}, {{edition|pad3}}.
 */

const WEEKDAY_SHORT: Record<string, string> = {
  понедельник: "ПН",
  вторник: "ВТ",
  среда: "СР",
  четверг: "ЧТ",
  пятница: "ПТ",
  суббота: "СБ",
  воскресенье: "ВС",
};

/** «в среду», «в пятницу»: винительный падеж для «до встречи в …». */
const WEEKDAY_ACC: Record<string, string> = {
  среда: "среду",
  пятница: "пятницу",
  суббота: "субботу",
};

/** «этот четверг», «эту среду», «это воскресенье»: для «открывается в этот …». */
const WEEKDAY_THIS: Record<string, string> = {
  понедельник: "этот понедельник",
  вторник: "этот вторник",
  среда: "эту среду",
  четверг: "этот четверг",
  пятница: "эту пятницу",
  суббота: "эту субботу",
  воскресенье: "это воскресенье",
};

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const CANONICAL_ORIGIN = "https://www.mynika.online";

/** Значения для подстановки в HTML: &, <, >, ". */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * JSON для вставки внутрь <script>: `<` экранируется как <, поэтому ни
 * `</script>`, ни `<!--` из данных тег не закроют. U+2028/2029 — для старых
 * движков, где они ломали строковые литералы.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** «12:30» + 40 минут → «13:10»; через полночь по кругу: 23:50 + 40 → «00:30». */
export function shiftTime(time: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) throw new Error(`время старта не в формате ЧЧ:ММ: ${time}`);
  const total = (((Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Объект EVENT, который скрипт страницы раньше держал захардкоженным. */
export function eventJsonOf(event: LandingEvent, origin: string): Record<string, unknown> {
  const url = `${origin}${event.path}`;
  // Подписи — для текстов, которые скрипт собирает сам (кнопка «Поделиться»,
  // экран «записан»): внутри <script> HTML-плейсхолдеры неуместны.
  const values = placeholderValues(event);
  const labels = {
    dateLabel: event.dateLabel,
    weekday: event.weekday,
    dateEn: values.date_en,
    weekdayEn: values.weekday_en,
    address: event.address,
    addressShort: values.address_short,
    place: event.place,
  };
  if (event.run) {
    return {
      spot: event.run.spot,
      date: event.date,
      time: event.startTime,
      gatherTime: event.gatherTime,
      edition: event.edition ?? null,
      source: event.landing,
      url,
      ...labels,
    };
  }
  const s = event.session!;
  return {
    ...labels,
    club: s.club,
    format: s.format,
    spot: s.spot,
    date: event.date,
    time: event.startTime,
    gatherAt: event.gatherTime,
    edition: s.edition,
    price: s.priceRub,
    capacity: s.capacity,
    source: event.landing,
    url,
  };
}

/** Значения плейсхолдеров события (без фильтров и без {{start±N}}). */
export function placeholderValues(event: LandingEvent): Record<string, string> {
  const [y, mo, d] = event.date.split("-").map(Number);
  const weekdayIndex = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const dd = String(d).padStart(2, "0");
  const mm = String(mo).padStart(2, "0");
  const values: Record<string, string> = {
    date_label: event.dateLabel,
    weekday: event.weekday,
    weekday_short: WEEKDAY_SHORT[event.weekday] ?? event.weekday.slice(0, 2).toUpperCase(),
    weekday_acc: WEEKDAY_ACC[event.weekday] ?? event.weekday,
    weekday_this: WEEKDAY_THIS[event.weekday] ?? event.weekday,
    weekday_en: WEEKDAYS_EN[weekdayIndex],
    date_iso: event.date,
    date_dm: `${dd}.${mm}`,
    date_dmy: `${dd}.${mm}.${y}`,
    date_en: `${d} ${MONTHS_EN[mo - 1]}`,
    year: String(y),
    gather_time: event.gatherTime,
    start_time: event.startTime,
    address: event.address,
    address_short: event.address.replace(/^Москва,\s*/, ""),
    place: event.place,
    metro: event.metro ?? "",
    map_url: event.mapUrl,
    edition: event.edition === undefined ? "" : String(event.edition),
    price_rub: event.priceRub === undefined ? "" : String(event.priceRub),
    spot: event.run?.spot ?? event.session?.spot ?? "",
  };
  return values;
}

const FILTERS: Record<string, (v: string) => string> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  cap: (v) => v.charAt(0).toUpperCase() + v.slice(1),
  pad3: (v) => v.padStart(3, "0"),
};

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+|start[+-]\d+)((?:\|[a-z0-9]+)*)\s*\}\}/g;

/**
 * Подставляет событие в шаблон. Незнакомый плейсхолдер или фильтр — ошибка, а
 * не тихая пустота: опечатка в шаблоне должна упасть в тесте, а не на проде.
 */
export function renderTemplate(html: string, event: LandingEvent, origin: string = CANONICAL_ORIGIN): string {
  // Лендинг-бандл (coffeerunluzhniki, см. scripts/coffeerun-landing.mjs): вся
  // разметка — JSON-строкой в <script type="__bundler/template">. Её
  // распаковываем, подставляем как обычный HTML и запаковываем обратно, иначе
  // кавычки из {{event_json}} порвали бы JSON-строку.
  const bundled = BUNDLE_TEMPLATE_RE.exec(html);
  if (bundled) {
    const inner = renderPlain(JSON.parse(bundled[2]) as string, event, origin);
    const encoded = JSON.stringify(inner).replace(/<\//g, "<\\u002F");
    const before = html.slice(0, bundled.index);
    const after = html.slice(bundled.index + bundled[0].length);
    return renderPlain(before, event, origin) + bundled[1] + encoded + bundled[3] + renderPlain(after, event, origin);
  }
  return renderPlain(html, event, origin);
}

const BUNDLE_TEMPLATE_RE = /(<script type="__bundler\/template"[^>]*>)([\s\S]*?)(<\/script>)/;

function renderPlain(html: string, event: LandingEvent, origin: string): string {
  const values = placeholderValues(event);
  return html.replace(PLACEHOLDER_RE, (_m, key: string, filterChain: string) => {
    if (key === "event_json") {
      if (filterChain) throw new Error("{{event_json}} не принимает фильтров");
      return scriptJson(eventJsonOf(event, origin));
    }
    let value: string;
    const shift = /^start([+-])(\d+)$/.exec(key);
    if (shift) {
      value = shiftTime(event.startTime, (shift[1] === "-" ? -1 : 1) * Number(shift[2]));
    } else if (key in values) {
      value = values[key];
    } else {
      throw new Error(`неизвестный плейсхолдер {{${key}}}`);
    }
    for (const name of filterChain.split("|").filter(Boolean)) {
      const filter = FILTERS[name];
      if (!filter) throw new Error(`неизвестный фильтр |${name} в {{${key}}}`);
      value = filter(value);
    }
    return escapeHtml(value);
  });
}

