import { Bot, type Context } from "grammy";
import {
  handleStartToken,
  handleOptIn,
  handleStop,
  findActiveBinding,
  sendConsentRequest,
} from "./linking";
import { handleResetCommand } from "./reset";
import {
  COFFEE_RUN_START_PREFIX,
  handleCoffeeRunStart,
  handleCoffeeRunByUsername,
  landingKeyboard,
} from "./coffeerun";
import { POLL_CALLBACK_RE } from "./poll-copy";
import { MOVED_CALLBACK_RE } from "./moved-copy";
import { handleMovedCommand, handleMovedCallback } from "./coffeerun-moved";
import {
  handleCoffeeRunPollAnswer,
  handlePollAdminCommand,
  handlePollSendCommand,
  handlePollStopCommand,
  handlePollSummaryCommand,
} from "./coffeerun-poll";
import { siteKeyboard, supportKeyboard, SUPPORT_LABEL, SUPPORT_URL } from "./cta";

/**
 * Бот мероприятий НИКИ. Снаружи он читается ровно как бот забегов:
 *   • подтверждает запись на кофе-ран (deep-link с лендинга или просто /start);
 *   • напоминает о старте накануне;
 *   • даёт кнопку живой поддержки, когда нужен человек, а не бот.
 *
 * Свободного диалога здесь нет: любой прочий ввод коротко объясняет роль и
 * отдаёт две кнопки — записаться и написать в поддержку.
 *
 * Привязка аккаунта НИКИ, opt-in и /reset остаются РАБОЧИМИ (приложение ходит
 * тем же токеном), но в текстах бота больше не рекламируются: снаружи это бот
 * мероприятий, а не «служебка» приложения.
 */
export type BotContext = Context;

const BOT_ROLE =
  "Я бот мероприятий НИКИ: подтверждаю запись на забеги и напоминаю о них накануне.";

/**
 * Куда идти дальше из любого «не понял тебя» сообщения: записаться на забег и
 * написать живому человеку. Без NEXT_PUBLIC_APP_URL ссылки на лендинг нет —
 * тогда остаётся одна поддержка.
 */
function eventKeyboard() {
  const landing = landingKeyboard();
  return landing ? landing.row().url(SUPPORT_LABEL, SUPPORT_URL) : supportKeyboard();
}

/** Токен бота. TELEGRAM_BOT_TOKEN — приоритетно, BOT_TOKEN — совместимость. */
function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN (или BOT_TOKEN) не задан");
  return t;
}

/** Опции reply с клавиатурой, только если она построена (нужен NEXT_PUBLIC_APP_URL). */
function withKeyboard(kb: ReturnType<typeof siteKeyboard>) {
  return kb ? { reply_markup: kb } : undefined;
}

function registerHandlers(bot: Bot<BotContext>): void {
  // ── /start ───────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    const token = (ctx.match ?? "").trim();

    // Deep-link с лендинга кофе-рана: /start cr_<token> → подтверждение записи.
    // Проверяем ПЕРВЫМ: префикс cr_ однозначно отделяет его от токена привязки.
    if (token.startsWith(COFFEE_RUN_START_PREFIX)) {
      await handleCoffeeRunStart(ctx, token);
      return;
    }

    // Deep-link из приложения: /start <token> → привязка аккаунта.
    if (token) {
      await handleStartToken(ctx, token);
      return;
    }

    // Без токена: сначала — неподтверждённая заявка на кофе-ран по нику. Человек
    // мог найти бота поиском вместо кнопки, и для него /start значит именно это.
    if (await handleCoffeeRunByUsername(ctx)) return;

    // Без токена, но чат уже привязан → статус / повторный запрос согласия.
    const chatId = ctx.from?.id;
    if (chatId !== undefined) {
      const binding = await findActiveBinding(chatId);
      if (binding) {
        if (binding.tg_opt_in) {
          await ctx.reply(
            "Мы на связи, напоминания включены. Приостановить — командой /stop.",
            withKeyboard(siteKeyboard()),
          );
        } else {
          await sendConsentRequest(ctx);
        }
        return;
      }
    }

    // Ни заявки, ни привязки: коротко о роли и куда идти за местом на старте.
    const name = ctx.from?.first_name ?? "друг";
    await ctx.reply(
      `Привет, ${name}! 👋\n\n${BOT_ROLE}\n\n` +
        "Заявки на твой ник я не нашла. Хочешь бежать — оставь её на странице " +
        "кофе-рана и нажми там «Подтвердить в Telegram».",
      { reply_markup: eventKeyboard() },
    );
  });

  // ── Команды-утилиты ────────────────────────────────────────────────────────
  bot.command("stop", (ctx) => handleStop(ctx)); // приостановить сообщения
  // /reset остаётся рабочим для приложения, но в /help не рекламируется —
  // снаружи бот про мероприятия.
  bot.command(["reset", "password"], (ctx) => handleResetCommand(ctx));

  // ── Опрос про погоду (только для организатора) ─────────────────────────────
  // Снаружи этих команд не видно: /help про них молчит, а незнакомому чату они
  // не отвечают вовсе. Вход — /admin <ключ> (ADMIN_SECRET). Подробности —
  // lib/telegram/coffeerun-poll.ts.
  bot.command("admin", (ctx) => handlePollAdminCommand(ctx));
  bot.command("pollsend", (ctx) => handlePollSendCommand(ctx));
  bot.command("poll", (ctx) => handlePollSummaryCommand(ctx));
  bot.command("pollstop", (ctx) => handlePollStopCommand(ctx));
  // Перенос старта на другое время того же дня — в два шага, с предпросмотром.
  bot.command("moved", (ctx) => handleMovedCommand(ctx));
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `${BOT_ROLE}\n\nКоманды:\n` +
        "/start — подтвердить запись на забег\n" +
        "/stop — приостановить сообщения\n\n" +
        "Нужен живой человек — кнопка «Служба поддержки» ниже.",
      { reply_markup: eventKeyboard() },
    );
  });

  // ── Инлайн-ответы уведомлений ───────────────────────────────────────────────
  bot.callbackQuery(/^optin_(yes|no)$/, (ctx) => handleOptIn(ctx, ctx.match[1] === "yes"));
  // Опрос по погоде («завтра дождь — побежишь?»): ответ ложится в заявку, id
  // которой вшит в кнопку. См. lib/telegram/coffeerun-poll.ts.
  bot.callbackQuery(POLL_CALLBACK_RE, (ctx) => handleCoffeeRunPollAnswer(ctx));
  // Подтверждение рассылки о переносе («Разослать» / «Отмена») — для организатора.
  bot.callbackQuery(MOVED_CALLBACK_RE, (ctx) => handleMovedCallback(ctx));
  // pure-push: интерактивного чек-ина больше нет. Хендлер оставлен пустым
  // «ловцом» — на случай устаревших сообщений с кнопками ans_* в проде: мягко
  // гасим «часик», НИЧЕГО не пишем (никаких answer/answered_at из Telegram).
  bot.callbackQuery(/^ans_/, (ctx) => ctx.answerCallbackQuery().catch(() => {}));

  // ── Любой прочий ввод: это не чат-бот — объясняем роль и даём кнопки ─────────
  bot.on("message", async (ctx) => {
    await ctx.reply(
      `${BOT_ROLE}\n\nСвободно общаться я не умею — но если нужен живой человек, ` +
        "нажми «Служба поддержки».",
      { reply_markup: eventKeyboard() },
    );
  });

  // ── Глобальный обработчик ошибок ─────────────────────────────────────────────
  bot.catch((err) => {
    console.error("[bot] Unhandled error:", err.message);
  });
}

// ── Ленивый синглтон ──────────────────────────────────────────────────────────
// Не создаём Bot на уровне модуля: grammY бросает на пустом токене, а это сломало
// бы `next build` (роут вебхука импортирует этот модуль до наличия env).
let _bot: Bot<BotContext> | null = null;

export function getBot(): Bot<BotContext> {
  if (_bot) return _bot;
  const bot = new Bot<BotContext>(botToken());
  registerHandlers(bot);
  _bot = bot;
  return bot;
}
