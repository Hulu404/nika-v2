import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, fakeClient, type FakeDb, type Row } from "../../test/fake-supabase";
import { surveyRow, YOGA } from "../../test/club-survey-row";
import type { BotContext } from "./bot";

/**
 * Сценарии участника целиком: хендлер → survey-flow → стор → «база» в памяти
 * → тексты, которые человек видит в личке. Подменяем только tgAdmin (базу),
 * sendBotMessage (ленту организаторам) и ctx — как в coffeerun-handler.test.ts.
 */

let db: FakeDb;

vi.mock("./supabase", () => ({ tgAdmin: () => fakeClient(db) }));

type Markup = { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined;

const feed: { chatId: number; text: string; keyboard?: Markup }[] = [];
vi.mock("./send", () => ({
  sendBotMessage: async (chatId: number, text: string, keyboard?: Markup) => {
    feed.push({ chatId, text, ...(keyboard ? { keyboard } : {}) });
    return { ok: true, messageId: 1 };
  },
}));

const { handleSurveyCallback, handleSurveyStart, handleSurveyText } = await import("./club-survey");
const { TEXT } = await import("./club-survey-copy");
const { __resetPollStateForTests, addAdminChat } = await import("./poll-store");

const { handleSurveyAdminCallback, __resetSurveyTestsForTests } = await import("./club-survey-admin");

const CHAT = 4242;
const ADMIN = 777;

interface Sent {
  message_id: number;
  text: string;
  keyboard: Markup;
}

/** Личка с ботом: что человек видит, что нажимает, что пишет. */
class Chat {
  sent: Sent[] = [];
  answered = 0;
  private nextId = 100;

  private ctx(extra: Record<string, unknown>) {
    return {
      from: { id: CHAT, first_name: "Аня", username: "anya" },
      chat: { id: CHAT, type: "private" },
      reply: async (text: string, opts?: { reply_markup?: Markup }) => {
        const msg = { message_id: this.nextId++, text, keyboard: opts?.reply_markup };
        this.sent.push(msg);
        return msg;
      },
      answerCallbackQuery: async () => {
        this.answered++;
      },
      editMessageReplyMarkup: async (opts: { reply_markup?: Markup }) => {
        const pressed = (extra.callbackQuery as { message: { message_id: number } }).message.message_id;
        this.setKeyboard(pressed, opts.reply_markup);
      },
      api: {
        editMessageReplyMarkup: async (_chat: number, messageId: number, opts: { reply_markup?: Markup }) => {
          this.setKeyboard(messageId, opts.reply_markup);
        },
      },
      ...extra,
    };
  }

  private setKeyboard(messageId: number, markup: Markup) {
    const msg = this.sent.find((m) => m.message_id === messageId);
    if (msg) msg.keyboard = markup;
  }

  async start() {
    return handleSurveyStart(this.ctx({ match: "yoga" }) as unknown as BotContext, YOGA);
  }

  /** Нажать кнопку по подписи — в последнем сообщении, где она ещё есть. */
  async press(label: string, opts: { from?: Sent } = {}) {
    const candidates = opts.from ? [opts.from] : [...this.sent].reverse();
    for (const msg of candidates) {
      const btn = (msg.keyboard?.inline_keyboard ?? []).flat().find((b) => b.text === label || b.text === `✓ ${label}`);
      if (!btn) continue;
      const ctx = this.ctx({ callbackQuery: { data: btn.callback_data, message: { message_id: msg.message_id } } });
      await handleSurveyCallback(ctx as unknown as BotContext);
      return;
    }
    throw new Error(`нет кнопки «${label}»`);
  }

  /** Написать текст. Возвращает, забрал ли его опрос. */
  async say(text: string) {
    return handleSurveyText(this.ctx({ message: { text, message_id: this.nextId++ } }) as unknown as BotContext);
  }

  last(): Sent {
    return this.sent[this.sent.length - 1];
  }

  labels(msg = this.last()): string[] {
    return (msg.keyboard?.inline_keyboard ?? []).flat().map((b) => b.text);
  }
}

function row(): Row | undefined {
  return db.tables.club_survey_responses?.find((r) => r.chat_id === CHAT);
}

beforeEach(() => {
  db = createFakeDb({
    club_survey_responses: (r) => {
      const base = surveyRow({ chat_id: r.chat_id as number });
      return { ...base, asked_at: new Date().toISOString(), ...r } as Row;
    },
    club_survey_results: (r, d) => ({
      id: (d.tables.club_survey_results?.length ?? 0) + 1,
      created_at: new Date().toISOString(),
      confirmed_at: null,
      bring: null,
      ...r,
    }),
  });
  feed.length = 0;
  __resetPollStateForTests();
  __resetSurveyTestsForTests();
  addAdminChat(ADMIN);
});

describe("полный путь «Приду»", () => {
  it("Интересно → согласие → Приду → чт и сб → два промежутка → текст 6 и итог", async () => {
    const chat = new Chat();

    expect(await chat.start()).toBe(true);
    expect(chat.last().text).toBe(TEXT.interest);
    expect(row()).toMatchObject({ source: "link", step: "interest", name: null });

    await chat.press("Интересно");
    expect(chat.last().text).toContain("нужно твоё согласие");
    expect(row()?.consent_at).toBeNull();

    await chat.press("Даю согласие");
    expect(row()).toMatchObject({ step: "attend", consent_version: "2026-09-30", name: "Аня", username: "anya" });
    expect(row()?.consent_at).not.toBeNull();

    await chat.press("Приду");
    expect(chat.last().text).toBe(TEXT.days);
    const daysMsg = chat.last();

    await chat.press("Чт 29.10");
    await chat.press("Сб 31.10");
    // Переключатели перерисованы на месте, новых сообщений нет.
    expect(chat.last()).toBe(daysMsg);
    expect(chat.labels(daysMsg)).toContain("✓ Чт 29.10");
    expect(chat.labels(daysMsg)).toContain("✓ Сб 31.10");
    expect(row()?.days).toEqual(["2026-10-29", "2026-10-31"]);

    await chat.press("Готово");
    expect(chat.labels(daysMsg)).toEqual([]);
    expect(chat.last().text).toBe(TEXT.timeWeekdays("чт"));

    expect(await chat.say("с 19 до 21")).toBe(true);
    expect(chat.last().text).toBe(TEXT.timeWeekend);

    // Как в подсказке: день человек пишет сам, разбор берёт только время.
    expect(await chat.say("сб с 11 до 14")).toBe(true);
    expect(chat.last().text).toBe(
      "Записали: чт 29.10 и сб 31.10, чт с 19:00 до 21:00, сб с 11:00 до 14:00. " +
        "В пятницу, 23 октября, пришлём дату, время и место.",
    );
    expect(chat.labels()).toEqual(["Изменить ответ"]);
    expect(row()).toMatchObject({
      step: "done",
      wd_from: "19:00",
      wd_to: "21:00",
      day_times: { "6": { from: "11:00", to: "14:00" } },
    });

    // Лента организатору — одна строка на завершение.
    expect(feed).toHaveLength(1);
    expect(feed[0].chatId).toBe(ADMIN);
    expect(feed[0].text).toContain("Аня (@anya) — придёт: чт 29.10, сб 31.10");

    // Итог: организатор разослал, человек отвечает «Буду».
    db.tables.club_survey_results = [
      {
        id: 1,
        survey_key: "yoga",
        meet_date: "2026-10-29",
        meet_time: "19:30",
        place: "студия",
        bring: null,
        created_at: "2026-10-23T09:00:00Z",
        confirmed_at: "2026-10-23T09:05:00Z",
      },
    ];
    Object.assign(row()!, { result_id: 1, result_variant: "match" });
    chat.sent.push({
      message_id: 999,
      text: "итог",
      keyboard: { inline_keyboard: [[{ text: "Буду", callback_data: "cs_yoga_ry_1" }, { text: "Планы поменялись", callback_data: "cs_yoga_rn_1" }]] },
    });

    await chat.press("Буду");
    expect(chat.last().text).toBe(TEXT.resultYes);
    expect(row()?.result_answer).toBe("yes");
    expect(feed[1].text).toContain("на итог: придёт. Всего идут: 1.");
  });
});

describe("разное время по дням", () => {
  async function toTime(chat: Chat, days: string[]) {
    await chat.start();
    await chat.press("Интересно");
    await chat.press("Даю согласие");
    await chat.press("Приду");
    for (const d of days) await chat.press(d);
    await chat.press("Готово");
  }

  it("одним сообщением про все дни — сразу текст 6", async () => {
    const chat = new Chat();
    await toTime(chat, ["Чт 29.10", "Пт 30.10", "Сб 31.10"]);

    expect(await chat.say("В четверг с 19 до 21, в пятницу после 18, а в субботу с 11 до 14")).toBe(true);
    expect(chat.last().text).toBe(
      "Записали: чт 29.10, пт 30.10 и сб 31.10, чт с 19:00 до 21:00, пт с 18:00 до 21:00, сб с 11:00 до 14:00. " +
        "В пятницу, 23 октября, пришлём дату, время и место.",
    );
    expect(feed[0].text).toContain("чт 19:00–21:00, пт 18:00–21:00, сб 11:00–14:00");
  });

  it("назвал не все дни — бот спрашивает про оставшийся", async () => {
    const chat = new Chat();
    await toTime(chat, ["Чт 29.10", "Пт 30.10"]);

    await chat.say("чт с 19 до 21");
    expect(chat.last().text).toBe("А в пт? Напиши, с какого и до какого часа. Например: с 19 до 21.");
    expect(chat.labels()).toEqual(["Подойдёт любое время"]);

    await chat.press("Подойдёт любое время");
    expect(chat.last().text).toMatch(/^Записали: чт 29\.10 и пт 30\.10, чт с 19:00 до 21:00, пт в любое время\./);
  });
});

describe("короткие ветки", () => {
  it("«Пока пропущу» — 1а с «Изменить ответ», имени не храним", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Пока пропущу");

    expect(chat.last().text).toBe(TEXT.skipped);
    expect(chat.labels()).toEqual(["Изменить ответ"]);
    expect(row()).toMatchObject({ step: "skipped", name: null, consent_at: null });

    await chat.press("Изменить ответ");
    expect(chat.last().text).toBe(TEXT.interest);
    expect(row()?.step).toBe("interest");
  });

  it("«Посмотрю итог в чате» — 2а без кнопок, ответов нет", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Интересно");
    await chat.press("Посмотрю итог в чате");

    expect(chat.last().text).toBe("Договорились! Итог опубликуем в чате кофе-ранов в пятницу, 23 октября.");
    expect(chat.labels()).toEqual([]);
    expect(row()).toMatchObject({ step: "declined", consent_at: null, name: null });
    expect(feed).toHaveLength(0);
  });

  it("«Присоединюсь позже» → «Пропустить» — 3б и строка в ленту", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Интересно");
    await chat.press("Даю согласие");
    await chat.press("Присоединюсь позже");
    expect(chat.last().text).toBe(TEXT.later);

    await chat.press("Пропустить");
    expect(chat.last().text).toBe(TEXT.laterDone);
    expect(row()).toMatchObject({ step: "later_done", attend: "later" });
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toContain("присоединится позже");
  });
});

describe("ввод времени", () => {
  async function toTime(chat: Chat) {
    await chat.start();
    await chat.press("Интересно");
    await chat.press("Даю согласие");
    await chat.press("Приду");
    await chat.press("Чт 29.10");
    await chat.press("Готово");
  }

  it("дважды неверно — сохраняем текст как есть, 5е и текст 6", async () => {
    const chat = new Chat();
    await toTime(chat);
    expect(chat.last().text).toBe(TEXT.time);

    await chat.say("как получится");
    expect(chat.last().text).toBe(TEXT.timeRetry);
    expect(row()?.fail_count).toBe(1);

    await chat.say("после работы");
    const texts = chat.sent.slice(-2).map((m) => m.text);
    expect(texts[0]).toBe(TEXT.timeSaved);
    expect(texts[1]).toMatch(/^Записали: чт 29\.10, время: «после работы»\. /);
    expect(row()).toMatchObject({ step: "done", wd_raw: "после работы", wd_from: null });
  });

  it("короткий промежуток — 5д", async () => {
    const chat = new Chat();
    await toTime(chat);
    await chat.say("19-19:30");
    expect(chat.last().text).toBe(TEXT.timeShort);
  });

  it("после ответа снимаем «Подойдёт любое время» с вопроса", async () => {
    const chat = new Chat();
    await toTime(chat);
    const question = chat.last();
    await chat.say("с 19 до 21");
    expect(chat.labels(question)).toEqual([]);
  });

  it("текст вне опроса и команды — не наши", async () => {
    const chat = new Chat();
    expect(await chat.say("привет")).toBe(false);
    await chat.start();
    expect(await chat.say("/help")).toBe(false);
    await chat.press("Пока пропущу");
    expect(await chat.say("привет")).toBe(false);
  });

  it("текст на шаге с кнопками — повтор шага", async () => {
    const chat = new Chat();
    await chat.start();
    const first = chat.last();
    expect(await chat.say("а что это?")).toBe(true);
    expect(chat.last().text).toBe(TEXT.interest);
    expect(chat.last()).not.toBe(first);
    expect(chat.labels(first)).toEqual([]);
  });
});

describe("повторы и старые кнопки", () => {
  it("/start yoga посреди опроса — повтор текущего шага, строка та же", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Интересно");
    await chat.press("Даю согласие");
    await chat.press("Приду");
    await chat.press("Чт 29.10");
    const daysMsg = chat.last();

    await chat.start();
    expect(chat.last().text).toBe(TEXT.days);
    expect(chat.last()).not.toBe(daysMsg);
    expect(chat.labels()).toContain("✓ Чт 29.10");
    expect(chat.labels(daysMsg)).toEqual([]);
    expect(db.tables.club_survey_responses).toHaveLength(1);
    expect(row()?.source).toBe("link");
  });

  it("нажатие старой кнопки — «часики» гасим, ничего не меняем", async () => {
    const chat = new Chat();
    await chat.start();
    const first = chat.last();
    await chat.press("Интересно");

    // Кнопки первого сообщения сняты; вернём их, как будто Telegram не успел.
    first.keyboard = {
      inline_keyboard: [[{ text: "Пока пропущу", callback_data: "cs_yoga_in" }]],
    };
    const before = { ...row() };
    const sentBefore = chat.sent.length;
    const answeredBefore = chat.answered;

    await chat.press("Пока пропущу", { from: first });

    expect(chat.answered).toBe(answeredBefore + 1);
    expect(chat.sent).toHaveLength(sentBefore);
    expect(row()).toEqual(before);
  });

  it("база упала — «часики» всё равно гасим", async () => {
    const chat = new Chat();
    await chat.start();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.failNext = 5;
    await chat.press("Интересно");
    expect(chat.answered).toBe(1);
    log.mockRestore();
  });

  it("/start yoga после «Пока пропущу» — шаг 1 заново", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Пока пропущу");
    await chat.start();
    expect(chat.last().text).toBe(TEXT.interest);
    expect(row()?.step).toBe("interest");
  });
});

describe("тестовый прогон организатора", () => {
  /** Организатор — сам CHAT: тест приходит ему в личку, сюда же вердикт. */
  async function startTest(chat: Chat) {
    addAdminChat(CHAT);
    const ctx = {
      from: { id: CHAT },
      chat: { id: CHAT, type: "private" },
      reply: async () => ({ message_id: 1 }),
      answerCallbackQuery: async () => {},
      editMessageReplyMarkup: async () => {},
    };
    await handleSurveyAdminCallback(ctx as unknown as BotContext, YOGA, { type: "test" });
    const start = feed.find((f) => f.chatId === CHAT && f.text === TEXT.interest)!;
    chat.sent.push({ message_id: 1, text: start.text, keyboard: start.keyboard });
  }

  const verdicts = () => feed.filter((f) => f.text.includes("Тест пройден"));

  it("дошёл до конца — в чат организатора приходят «Апрув» и «На доработку», один раз", async () => {
    const chat = new Chat();
    await startTest(chat);
    await chat.press("Пока пропущу");

    expect(verdicts()).toHaveLength(1);
    expect(verdicts()[0].chatId).toBe(CHAT);
    expect((verdicts()[0].keyboard?.inline_keyboard ?? []).flat().map((b) => b.text)).toEqual([
      "Апрув — разослать всем",
      "На доработку",
    ]);

    // Повторный тап по старой кнопке вердикт не задваивает.
    await chat.say("ещё раз");
    expect(verdicts()).toHaveLength(1);
  });

  it("посреди теста вердикта нет", async () => {
    const chat = new Chat();
    await startTest(chat);
    await chat.press("Интересно");
    expect(verdicts()).toHaveLength(0);
  });

  it("обычный участник, дошедший до конца, вердикта не получает", async () => {
    const chat = new Chat();
    await chat.start();
    await chat.press("Пока пропущу");
    expect(verdicts()).toHaveLength(0);
  });
});
