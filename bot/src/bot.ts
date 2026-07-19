// ⚠️ РЕТАЙРНУТО. Этот polling-энтрипоинт больше не используется в проде.
// Бот переведён на webhook внутри Next-приложения: композер — lib/telegram/bot.ts,
// приём апдейтов — app/api/telegram/webhook, локальный dev — `npm run bot:dev`
// в корне репозитория. Файл оставлен для истории.
import "dotenv/config";
import { Bot, InlineKeyboard, session, type Context, type SessionFlavor } from "grammy";
import { config } from "./config";
import { getNikaResponse } from "./nika";
import { SCENARIO_META, isScenario } from "./scenarios";
import { menuKeyboard, chatKeyboard } from "./keyboards";
import type { SessionData } from "./types";

// ─── Типизированный контекст с сессией ───────────────────────────────────────

type MyContext = Context & SessionFlavor<SessionData>;

// ─── Инициализация бота ───────────────────────────────────────────────────────

const bot = new Bot<MyContext>(config.botToken);

// Сессия в памяти (сбрасывается при рестарте).
// Для персистентности можно подключить @grammyjs/storage-supabase.
bot.use(
  session<SessionData, MyContext>({
    initial: (): SessionData => ({ scenario: null, messages: [] }),
  }),
);

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/** Отправляет типинг-индикатор каждые 4 с, пока идёт запрос к Anthropic. */
function startTyping(ctx: MyContext): ReturnType<typeof setInterval> {
  void ctx.replyWithChatAction("typing");
  return setInterval(() => void ctx.replyWithChatAction("typing"), 4_000);
}

/** Сбрасывает диалог и показывает главное меню. */
async function showMenu(ctx: MyContext): Promise<void> {
  ctx.session.scenario = null;
  ctx.session.messages = [];
  await ctx.reply(
    "Выбери, о чём хочешь поговорить с НИКОЙ:",
    { reply_markup: menuKeyboard() },
  );
}

// ─── Команды ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ?? "друг";
  await ctx.reply(
    `Привет, ${name}! 👋\n\nЯ — НИКА, ментальный ассистент для бегунов-любителей.\n\nЯ не тренер. Я рядом, чтобы ты не бросил бег.`,
  );
  await showMenu(ctx);
});

bot.command("menu", async (ctx) => {
  await showMenu(ctx);
});

// ─── Выбор сценария ───────────────────────────────────────────────────────────

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

// ─── Кнопка «Сменить сценарий» ────────────────────────────────────────────────

bot.callbackQuery("back_to_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Убираем кнопки у последнего сообщения.
  // Передаём пустую клавиатуру — это единственный способ убрать inline кнопки в Telegram.
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
  await showMenu(ctx);
});

// ─── Основной обработчик сообщений ───────────────────────────────────────────

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
    console.error("[bot] Anthropic error:", err);
    await ctx.reply(
      "Что-то пошло не так — не смогла получить ответ. Попробуй ещё раз.",
    );
    // Убираем неудавшуюся реплику пользователя из истории.
    messages.pop();
  } finally {
    clearInterval(typingInterval);
  }
});

// ─── Обработка неподдерживаемых типов сообщений ──────────────────────────────

bot.on("message", async (ctx) => {
  await ctx.reply(
    "Я понимаю только текстовые сообщения. Напиши что-нибудь словами 🙂",
  );
});

// ─── Глобальный обработчик ошибок ────────────────────────────────────────────

bot.catch((err) => {
  console.error("[bot] Unhandled error:", err.message, err.error);
});

// ─── Запуск ───────────────────────────────────────────────────────────────────

console.log("НИКА бот запускается (polling)...");
bot.start({
  onStart: (info) => console.log(`Бот запущен: @${info.username}`),
});
