import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COFFEE_RUNS } from "../coffeerun/run";
import { SESSIONS } from "../clubs/sessions";
import { fromRun, fromSession, upcomingEvents } from "../landings/events";
import { renderLanding } from "../landings/render";
import type { MyClubRow, MyCoffeeRunRow } from "./my-signups";

// Черновик рассылки (/say) и текстовые шаги опроса — управляемые: тест
// порядка проверяет, что меню их не перехватывает.
const drafts = vi.hoisted(() => ({ broadcast: false }));
vi.mock("./coffeerun-broadcast", () => ({
  handleBroadcastDraft: vi.fn(async (ctx: { reply: (t: string) => Promise<unknown> }) => {
    if (!drafts.broadcast) return false;
    await ctx.reply("ПРЕВЬЮ РАССЫЛКИ");
    return true;
  }),
  handleBroadcastCallback: vi.fn(),
  handleSayCommand: vi.fn(),
}));
vi.mock("./club-survey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./club-survey")>()),
  handleSurveyText: vi.fn(async () => false),
}));
vi.mock("./linking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./linking")>()),
  findActiveBinding: vi.fn(async () => null),
}));

const {
  MENU_MY_SIGNUPS,
  MENU_SCHEDULE,
  MENU_SCHEDULE_CALLBACK,
  MENU_SUPPORT,
  MENU_DONATE,
  HELP_TEXT,
  NO_EVENTS_TEXT,
  NO_UPCOMING_SIGNUPS_TEXT,
  UNKNOWN_INPUT_TEXT,
  SCHEDULE_LIMIT,
  eventWhen,
  handleMySignupsMenu,
  menuKeyboard,
  mySignupsView,
  scheduleView,
  soldOutKey,
} = await import("./menu");
const { registerHandlers } = await import("./bot");

const ORIGIN = "https://www.mynika.online";
const NOW = new Date("2026-11-05T12:00:00+03:00");
const buttons = (kb: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }) =>
  kb.inline_keyboard.flat();

const cave = COFFEE_RUNS.find((r) => r.spot === "cave")!;
const pilates = SESSIONS.find((s) => s.club === "stretch" && s.date === "2026-11-08")!;
const read = SESSIONS.find((s) => s.club === "read")!;

describe("клавиатура меню", () => {
  it("три кнопки в две строки, постоянная и компактная; «Поддержать» пока не показываем", () => {
    const kb = menuKeyboard();
    expect(kb.keyboard.map((row) => row.map((b) => (typeof b === "string" ? b : b.text)))).toEqual([
      [MENU_SCHEDULE, MENU_MY_SIGNUPS],
      [MENU_SUPPORT],
    ]);
    expect(kb.is_persistent).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
    expect(JSON.stringify(kb.keyboard)).not.toContain(MENU_DONATE);
  });
});

describe("📅 Расписание", () => {
  it("забеги и занятия вместе, по дате; цена клуба; кнопки на лендинги с utm", () => {
    const events = upcomingEvents(NOW);
    const view = scheduleView(events, new Set(), ORIGIN);
    const order = ["Пилатес на коврике", "Книжный клуб", "Кофе-ран · Surf Coffee® × Cave"].map((t) => view.text.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(view.text).toContain("🧘 Пилатес на коврике\n8 ноября, вс, сбор 11:30, старт 12:00");
    expect(view.text).toContain("1000 ₽");
    expect(view.text).toContain("📚 Книжный клуб\n12 ноября, чт, сбор 18:45, старт 19:00");
    expect(view.text).toContain("бесплатно");
    expect(view.text).toContain("🏃 Кофе-ран · Surf Coffee® × Cave\n15 ноября, вс, сбор 12:00, старт 12:30\nНовокузнецкая улица, дом 6");
    expect(buttons(view.keyboard)).toContainEqual({
      text: "Записаться: кофе-ран, 15 ноября",
      url: `${ORIGIN}/coffeerunsurfcave?utm_source=bot&utm_medium=menu`,
    });
    expect(buttons(view.keyboard)).toContainEqual({
      text: "Записаться: пилатес, 8 ноября",
      url: `${ORIGIN}/stretch?utm_source=bot&utm_medium=menu`,
    });
  });

  it("дата и время в строке — те же, что на лендинге этого события", () => {
    for (const event of upcomingEvents(NOW)) {
      const html = renderLanding(event.landing, NOW)!;
      expect(html).toContain(event.dateLabel);
      expect(html).toContain(event.gatherTime);
      expect(html).toContain(event.startTime);
      expect(eventWhen(event)).toContain(`сбор ${event.gatherTime}, старт ${event.startTime}`);
    }
  });

  it("не больше шести событий", () => {
    const many = Array.from({ length: 9 }, (_, i) => fromRun({ ...cave, date: `2026-12-${String(i + 1).padStart(2, "0")}` }));
    const view = scheduleView(many, new Set(), ORIGIN);
    expect(buttons(view.keyboard)).toHaveLength(SCHEDULE_LIMIT);
    expect(view.text.match(/🏃/g)).toHaveLength(SCHEDULE_LIMIT);
  });

  it("мест нет — так и пишем, кнопка ведёт на ту же страницу (там лист ожидания)", () => {
    const event = fromSession(pilates);
    const view = scheduleView([event], new Set([soldOutKey(event)]), ORIGIN);
    expect(view.text).toContain("мест нет, можно в лист ожидания");
    expect(view.text).not.toContain("1000 ₽");
    expect(buttons(view.keyboard)[0].url).toBe(`${ORIGIN}/stretch?utm_source=bot&utm_medium=menu`);
  });

  it("событий нет — про скорое расписание и кнопка на чат сообщества", () => {
    const view = scheduleView([], new Set(), ORIGIN);
    expect(view.text).toBe(NO_EVENTS_TEXT);
    expect(buttons(view.keyboard)).toEqual([{ text: "Чат сообщества", url: "https://t.me/nika_community" }]);
  });
});

const coffeeRow = (patch: Partial<MyCoffeeRunRow> = {}): MyCoffeeRunRow => ({
  id: "c1",
  spot: "cave",
  run_date: cave.date,
  confirmed_at: "2026-11-01T10:00:00Z",
  rollcall_answer: null,
  ...patch,
});
const clubRow = (patch: Partial<MyClubRow> = {}): MyClubRow => ({
  id: "o1",
  confirm_token: "a".repeat(32),
  club: "stretch",
  event_date: pilates.date,
  event_time: pilates.time,
  payment_status: "paid",
  amount_rub: 1000,
  confirmed_at: "2026-11-01T10:00:00Z",
  is_gift: false,
  quantity: 1,
  hold_expires_at: null,
  yk_confirmation_url: null,
  ...patch,
});

describe("🎟 Мои записи", () => {
  it("оплаченный пилатес и подтверждённый кофе-ран — оба события, маршруты и верный счётчик", () => {
    const view = mySignupsView({
      coffee: [
        coffeeRow(),
        coffeeRow({ id: "c2", spot: "luzhniki", run_date: "2026-09-20" }),
        coffeeRow({ id: "c3", spot: "usachevo", run_date: "2026-11-01" }),
        coffeeRow({ id: "c4", spot: "usachevo", run_date: "2026-10-18", confirmed_at: null }),
      ],
      club: [clubRow({ quantity: 2 }), clubRow({ id: "o0", event_date: "2026-11-01", event_time: "10:30" })],
      rollcallDates: new Set(),
      now: NOW,
    });
    expect(view.text).toContain("🧘 Пилатес на коврике — оплачено, 2 билета\n8 ноября, вс, сбор 11:30, старт 12:00");
    expect(view.text).toContain("🏃 Кофе-ран · Surf Coffee® × Cave\n15 ноября, вс, сбор 12:00, старт 12:30");
    expect(view.text.indexOf("Пилатес")).toBeLessThan(view.text.indexOf("Кофе-ран"));
    expect(view.text.trim().split("\n").at(-1)).toBe("Ты был с нами: кофе-ранов 2, занятий клуба 1");
    expect(buttons(view.keyboard)).toEqual([
      { text: "Маршрут: пилатес, 8 ноября", url: pilates.mapUrl },
      { text: "Маршрут: кофе-ран, 15 ноября", url: cave.mapUrl },
    ]);
  });

  it("бесплатная встреча — «записан», не «оплачено»", () => {
    const view = mySignupsView({
      coffee: [],
      club: [clubRow({ club: "read", event_date: read.date, event_time: read.time, amount_rub: 0 })],
      rollcallDates: new Set(),
      now: NOW,
    });
    expect(view.text).toContain("📚 Книжный клуб — записан");
  });

  it("ждёт оплаты с живым холдом — «Оплатить»: ссылка ЮKassa, а без неё тот же путь, что «Проверить ещё раз»", () => {
    const hold = new Date(NOW.getTime() + 10 * 60_000).toISOString();
    const withUrl = mySignupsView({
      coffee: [],
      club: [clubRow({ payment_status: "pending_payment", hold_expires_at: hold, yk_confirmation_url: "https://yoomoney.ru/pay/1" })],
      rollcallDates: new Set(),
      now: NOW,
    });
    expect(withUrl.text).toContain("— ждёт оплаты");
    expect(buttons(withUrl.keyboard)).toEqual([{ text: "Оплатить: пилатес, 8 ноября", url: "https://yoomoney.ru/pay/1" }]);

    const noUrl = mySignupsView({
      coffee: [],
      club: [clubRow({ payment_status: "pending_payment", hold_expires_at: hold })],
      rollcallDates: new Set(),
      now: NOW,
    });
    expect(buttons(noUrl.keyboard)).toEqual([{ text: "Оплатить: пилатес, 8 ноября", callback_data: `stpay:${"a".repeat(32)}` }]);
  });

  it("холд истёк, отмена, возврат — впереди не показываем", () => {
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    const view = mySignupsView({
      coffee: [],
      club: [
        clubRow({ payment_status: "pending_payment", hold_expires_at: past }),
        clubRow({ id: "o2", payment_status: "canceled" }),
        clubRow({ id: "o3", payment_status: "refunded" }),
      ],
      rollcallDates: new Set(),
      now: NOW,
    });
    expect(view.text).toBe(NO_UPCOMING_SIGNUPS_TEXT);
  });

  it("лист ожидания", () => {
    const view = mySignupsView({ coffee: [], club: [clubRow({ payment_status: "waitlist" })], rollcallDates: new Set(), now: NOW });
    expect(view.text).toContain("🧘 Пилатес на коврике — в листе ожидания");
  });

  it("ничего впереди — «Впереди записей нет» и инлайн-кнопка расписания", () => {
    const view = mySignupsView({ coffee: [], club: [], rollcallDates: new Set(), now: NOW });
    expect(view.text).toBe(NO_UPCOMING_SIGNUPS_TEXT);
    expect(buttons(view.keyboard)).toEqual([{ text: MENU_SCHEDULE, callback_data: MENU_SCHEDULE_CALLBACK }]);
  });
});

/**
 * Мини-Supabase: from().select().eq().in().not().order() и update().select().
 * Неизвестная колонка в select — ошибка 42703, как у PostgREST без миграции.
 */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, columns: Record<string, string[]>) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let selected = "";
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select(cols: string) {
          selected = cols;
          return builder;
        },
        update(p: Record<string, unknown>) {
          patch = p;
          return builder;
        },
        eq(col: string, value: unknown) {
          calls.push(`${table}.${col}=${value}`);
          filters.push((r) => r[col] === value);
          return builder;
        },
        in(col: string, values: unknown[]) {
          filters.push((r) => values.includes(r[col]));
          return builder;
        },
        not(col: string) {
          filters.push((r) => r[col] !== null && r[col] !== undefined);
          return builder;
        },
        order() {
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          const unknown = selected
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c && !(columns[table] ?? []).includes(c));
          if (unknown.length) return resolve({ data: null, error: { code: "42703", message: `column ${table}.${unknown[0]} does not exist` } });
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (patch) rows.forEach((r) => Object.assign(r, patch));
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("🎟 Мои записи: поиск в базе", () => {
  const COFFEE_COLS = ["id", "spot", "run_date", "confirmed_at", "tg_chat_id", "tg_username"];
  const CLUB_COLS = [
    "id", "confirm_token", "club", "event_date", "event_time", "payment_status", "amount_rub", "confirmed_at",
    "is_gift", "quantity", "hold_expires_at", "yk_confirmation_url", "tg_chat_id", "tg_username",
  ];

  it("по чату пусто — ищет по нику (без @ и регистра); без миграции 072 не падает", async () => {
    const { db, calls } = fakeDb(
      {
        coffee_run_signups: [{ ...coffeeRow(), tg_chat_id: null, tg_username: "nika_test" }],
        club_signups: [{ ...clubRow(), tg_chat_id: 777, tg_username: "nika_test" }],
      },
      // Колонок rollcall_* нет: миграция не применена.
      { coffee_run_signups: COFFEE_COLS, club_signups: CLUB_COLS },
    );
    const replies: Array<{ text: string; markup: unknown }> = [];
    const ctx = {
      from: { id: 777, username: "@Nika_Test" },
      reply: vi.fn(async (text: string, other: { reply_markup: unknown }) => replies.push({ text, markup: other.reply_markup })),
    };
    await handleMySignupsMenu(ctx as never, { db: () => db, now: () => NOW });
    expect(calls).toContain("coffee_run_signups.tg_chat_id=777");
    expect(calls).toContain("coffee_run_signups.tg_username=nika_test");
    // В club_signups по чату нашлось — по нику не ищем.
    expect(calls).not.toContain("club_signups.tg_username=nika_test");
    expect(replies[0].text).toContain("Кофе-ран · Surf Coffee® × Cave");
    expect(replies[0].text).toContain("Пилатес на коврике — оплачено");
  });
});

describe("бот: меню, /start, /help и порядок обработчиков", () => {
  let calls: Array<{ method: string; payload: Record<string, unknown> }>;
  let bot: Bot;

  const update = (text: string, id = 1) => ({
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: 555, type: "private" as const, first_name: "Ника" },
      from: { id: 555, is_bot: false, first_name: "Ника" },
      text,
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] } : {}),
    },
  });
  const sent = () => calls.filter((c) => c.method === "sendMessage");

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
    drafts.broadcast = false;
    calls = [];
    bot = new Bot("123:test", {
      botInfo: {
        id: 1, is_bot: true, first_name: "NIKA", username: "nika_test_bot",
        can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
        can_connect_to_business: false, has_main_web_app: false,
      } as never,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: 555, type: "private" } } } as never;
    });
    registerHandlers(bot as never);
  });

  const menuRows = (payload: Record<string, unknown>) =>
    ((payload.reply_markup as { keyboard?: Array<Array<{ text: string } | string>> })?.keyboard ?? []).map((row) =>
      row.map((b) => (typeof b === "string" ? b : b.text)),
    );

  it("/start без заявки — меню внизу", async () => {
    await bot.handleUpdate(update("/start"));
    const last = sent().at(-1)!;
    expect(menuRows(last.payload)).toEqual([[MENU_SCHEDULE, MENU_MY_SIGNUPS], [MENU_SUPPORT]]);
  });

  it("/help — команды и меню", async () => {
    await bot.handleUpdate(update("/help"));
    expect(sent().at(-1)!.payload.text).toBe(HELP_TEXT);
    expect(menuRows(sent().at(-1)!.payload)).toHaveLength(2);
  });

  it("непонятный ввод — роль бота и меню", async () => {
    await bot.handleUpdate(update("привет, а что ты умеешь?"));
    expect(sent().at(-1)!.payload.text).toBe(UNKNOWN_INPUT_TEXT);
    expect(menuRows(sent().at(-1)!.payload)).toHaveLength(2);
  });

  it("кнопка «📅 Расписание» открывает расписание", async () => {
    await bot.handleUpdate(update(MENU_SCHEDULE));
    const text = String(sent().at(-1)!.payload.text);
    expect(text.startsWith("Ближайшие события:") || text === NO_EVENTS_TEXT).toBe(true);
  });

  it("после /say надпись «📅 Расписание» — это текст рассылки, а не экран расписания", async () => {
    drafts.broadcast = true;
    await bot.handleUpdate(update(MENU_SCHEDULE));
    expect(sent().map((c) => c.payload.text)).toEqual(["ПРЕВЬЮ РАССЫЛКИ"]);
  });

  it("кнопка поддержки — ссылка на живого человека", async () => {
    await bot.handleUpdate(update(MENU_SUPPORT));
    const markup = sent().at(-1)!.payload.reply_markup as { inline_keyboard: Array<Array<{ url: string }>> };
    expect(markup.inline_keyboard.flat()[0].url).toBe("https://t.me/meine_nika");
  });
});
