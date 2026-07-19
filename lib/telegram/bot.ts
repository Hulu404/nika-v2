import {
  Bot,
  InlineKeyboard,
  session,
  type Context,
  type SessionFlavor,
} from "grammy";
import { getNikaResponse } from "./nika";
import { SCENARIO_META, isScenario } from "./scenarios";
import { menuKeyboard, chatKeyboard } from "./keyboards";
import { supabaseSessionStorage } from "./storage";
import { handleStartToken, handleOptIn } from "./linking";
import type { SessionData } from "./types";

export type BotContext = Context & SessionFlavor<SessionData>;

/** Токен бота. TELEGRAM_BOT_TOKEN — приоритетно, BOT_TOKEN — совместимость. */
function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN (или BOT_TOKEN) не задан");
  return t;
}

// ── Утилиты ─────────────────────────────────────────────────────────────────

/** Отправляет типинг-индикатор каждые 4 с, пока идёт запрос к Anthropic. */
function startTyping(ctx: BotContext): ReturnType<typeof setInterval> {
  void ctx.replyWithChatAction("typing");
  return setInterval(() => void ctx.replyWithChatAction("typing"), 4_000);
}

/** Сбрасывает диалог и показывает главное меню. */
async function showMenu(ctx: BotContext): Promise<void> {
  ctx.session.scenario = null;
  ctx.session.messages = [];
  await ctx.reply("Выбери, о чём хочешь поговорить с НИКОЙ:", {
    reply_markup: menuKeyboard(),
  });
}

/**
 * Регистрирует все хендлеры на экземпляр бота. Логика сохранена из bot/src/bot.ts;
 * отличие — сессия хранится в БД (StorageAdapter), а не в памяти.
 */
function registerHandlers(bot: Bot<BotContext>): void {
  // Сессия в БД: ключ — id чата, поэтому состояние переживает рестарты/инстансы.
  bot.use(
    session<SessionData, BotContext>({
      initial: (): SessionData => ({ scenario: null, messages: [] }),
      storage: supabaseSessionStorage<SessionData>(),
      getSessionKey: (ctx) =>
        ctx.chat?.id !== undefined ? String(ctx.chat.id) : undefined,
    }),
  );

  // ── Команды ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    // Deep-link из приложения: /start <token> → привязка аккаунта.
    const token = (ctx.match ?? "").trim();
    if (token) {
      await handleStartToken(ctx, token);
      return;
    }

    // Без токена: короткое приветствие + подсказка подключиться из настроек.
    const name = ctx.from?.first_name ?? "друг";
    await ctx.reply(
      `Привет, ${name}! 👋\n\nЯ — НИКА, ментальный ассистент для бегунов-любителей.\n\nЯ не тренер. Я рядом, чтобы ты не бросил бег.\n\nЧтобы я могла писать сюда, подключи Telegram в настройках НИКИ (раздел профиля).`,
    );
    await showMenu(ctx);
  });

  // ── Opt-in на проактивные сообщения (после привязки) ─────────────────────────
  bot.callbackQuery(/^tg_optin:(yes|no)$/, async (ctx) => {
    await handleOptIn(ctx, ctx.match[1] === "yes");
  });

  bot.command("menu", async (ctx) => {
    await showMenu(ctx);
  });

  // ── Выбор сценария ───────────────────────────────────────────────────────────
  bot.callbackQuery(/^scenario:(.+)$/, async (ctx) => {
    const raw = ctx.match[1];
    if (!isScenario(raw)) {
      await ctx.answerCallbackQuery("Неизвестный сценарий");
      return;
    }

    await ctx.answerCallbackQuery();

    const meta = SCENARIO_META[raw];

    // Сохраняем сценарий и кладём открывашку НИКИ первым сообщением в историю.
    ctx.session.scenario = raw;
    ctx.session.messages = [{ role: "assistant", content: meta.opener }];

    // Редактируем исходное сообщение меню, чтобы убрать кнопки.
    await ctx.editMessageText(`*${meta.label}*`, { parse_mode: "Markdown" }).catch(() => {});

    // Отправляем открывашку НИКИ с кнопкой смены сценария.
    await ctx.reply(meta.opener, { reply_markup: chatKeyboard() });
  });

  // ── Кнопка «Сменить сценарий» ─────────────────────────────────────────────────
  bot.callbackQuery("back_to_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Убираем кнопки у последнего сообщения (пустая клавиатура — единственный способ).
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
    await showMenu(ctx);
  });

  // ── Основной обработчик сообщений ─────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const { scenario, messages } = ctx.session;

    // Если сценарий не выбран — направляем в меню.
    if (!scenario) {
      await showMenu(ctx);
      return;
    }

    const userText = ctx.message.text.trim();
    if (!userText) return;

    // Добавляем реплику пользователя в историю.
    messages.push({ role: "user", content: userText });

    const typingInterval = startTyping(ctx);

    try {
      const nikaReply = await getNikaResponse(scenario, messages);

      // Сохраняем ответ НИКИ в историю.
      messages.push({ role: "assistant", content: nikaReply });

      await ctx.reply(nikaReply, { reply_markup: chatKeyboard() });
    } catch (err) {
      console.error("[bot] Anthropic error:", err instanceof Error ? err.message : String(err));
      await ctx.reply("Что-то пошло не так — не смогла получить ответ. Попробуй ещё раз.");
      // Убираем неудавшуюся реплику пользователя из истории.
      messages.pop();
    } finally {
      clearInterval(typingInterval);
    }
  });

  // ── Неподдерживаемые типы сообщений ──────────────────────────────────────────
  bot.on("message", async (ctx) => {
    await ctx.reply("Я понимаю только текстовые сообщения. Напиши что-нибудь словами 🙂");
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
