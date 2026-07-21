import { Bot, type Context } from "grammy";
import {
  handleStartToken,
  handleOptIn,
  handleStop,
  findActiveBinding,
  sendConsentRequest,
} from "./linking";
import { handleResetCommand } from "./reset";
import { siteKeyboard } from "./cta";

/**
 * Служебный бот НИКИ. Его роль — НЕ второй чат-клон, а канал уведомлений:
 *   • напоминания (утренние чек-ины) с кнопкой перехода на сайт;
 *   • сброс пароля (/reset и доставка ссылки, инициированной с сайта);
 *   • привязка аккаунта и управление согласием (opt-in / /stop).
 *
 * Свободного диалога с Anthropic здесь нет — общение с НИКОЙ живёт на сайте.
 * Поэтому нет ни сессий, ни меню сценариев: любой прочий ввод уводит на сайт.
 */
export type BotContext = Context;

const BOT_ROLE =
  "Я служебный бот НИКИ. Присылаю напоминания и помогаю сбросить пароль. " +
  "Пообщаться с НИКОЙ, посмотреть «Мой ритм» и всё остальное — на сайте.";

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
    // Deep-link из приложения: /start <token> → привязка аккаунта.
    const token = (ctx.match ?? "").trim();
    if (token) {
      await handleStartToken(ctx, token);
      return;
    }

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

    // Не привязан: коротко о роли бота + как подключить (из профиля на сайте).
    const name = ctx.from?.first_name ?? "друг";
    await ctx.reply(
      `Привет, ${name}! 👋\n\n${BOT_ROLE}\n\nЧтобы я могла присылать напоминания, подключи Telegram в профиле НИКИ.`,
      withKeyboard(siteKeyboard()),
    );
  });

  // ── Команды-утилиты ────────────────────────────────────────────────────────
  bot.command("stop", (ctx) => handleStop(ctx)); // приостановить напоминания
  bot.command(["reset", "password"], (ctx) => handleResetCommand(ctx)); // сброс пароля
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `${BOT_ROLE}\n\nКоманды:\n/reset — сбросить пароль\n/stop — приостановить напоминания\n/start — подключить или возобновить`,
      withKeyboard(siteKeyboard()),
    );
  });

  // ── Инлайн-ответы уведомлений ───────────────────────────────────────────────
  bot.callbackQuery(/^optin_(yes|no)$/, (ctx) => handleOptIn(ctx, ctx.match[1] === "yes"));
  // pure-push: интерактивного чек-ина больше нет. Хендлер оставлен пустым
  // «ловцом» — на случай устаревших сообщений с кнопками ans_* в проде: мягко
  // гасим «часик», НИЧЕГО не пишем (никаких answer/answered_at из Telegram).
  bot.callbackQuery(/^ans_/, (ctx) => ctx.answerCallbackQuery().catch(() => {}));

  // ── Любой прочий ввод: это не чат-бот — коротко уводим на сайт ───────────────
  bot.on("message", async (ctx) => {
    await ctx.reply(BOT_ROLE, withKeyboard(siteKeyboard()));
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
