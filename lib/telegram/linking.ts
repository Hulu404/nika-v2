import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import type { BotContext } from "./bot";

/**
 * Формулировка согласия — В ОДНОМ МЕСТЕ (для сверки с privacy-политикой сайта,
 * 152-ФЗ). Момент согласия фиксируется в tg_bindings.tg_opt_in_at.
 */
export const CONSENT_VERSION = "2026-07-18";

export const CONSENT_PROMPT =
  "Можно я буду иногда писать сюда сама, по утрам? Коротко и по делу, без спама. Приостановить можно в любой момент.";

/** Инлайн-кнопки согласия. callback_data — optin_yes / optin_no. */
export function consentKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Согласна получать сообщения", "optin_yes")
    .row()
    .text("Пока не надо", "optin_no");
}

/** Отправляет запрос согласия (после привязки и по /start у привязанного). */
export async function sendConsentRequest(ctx: BotContext): Promise<void> {
  await ctx.reply(CONSENT_PROMPT, { reply_markup: consentKeyboard() });
}

/**
 * Привязка Telegram по одноразовому токену из deep-link (t.me/<bot>?start=<token>).
 * chat_id получаем на сервере из ctx.from.id (нельзя подделать через payload).
 *
 * Коллизии (раздел 11 ТЗ):
 *   A) chat_id уже привязан к ДРУГОМУ активному аккаунту → не перепривязываем
 *      молча: просим сначала отвязать там. Токен НЕ гасим (можно повторить).
 *   B) у аккаунта из токена уже есть активная связка с ДРУГИМ chat_id →
 *      заменяем: старую помечаем is_active=false, unlink_reason='relinked'.
 *
 * Клавиатура opt-in запрашивается сразу после успешной привязки (см. handleOptIn).
 */
export async function handleStartToken(ctx: BotContext, token: string): Promise<void> {
  const admin = tgAdmin();
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;

  const { data: tok } = await admin
    .from("tg_link_tokens")
    .select("token, user_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  // Просрочен / использован / не найден → вежливый отказ, связку не создаём.
  const expired = !tok || tok.used_at !== null || new Date(tok.expires_at) <= new Date();
  if (expired) {
    await ctx.reply(
      "Ссылка привязки недействительна или устарела. Открой настройки НИКИ и нажми «Подключить Telegram» ещё раз.",
    );
    return;
  }

  const userId = tok.user_id as string;

  // Коллизия A: этот chat уже за другим активным аккаунтом.
  const { data: byChat } = await admin
    .from("tg_bindings")
    .select("id, user_id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (byChat && byChat.user_id !== userId) {
    await ctx.reply(
      "Этот Telegram уже привязан к другому аккаунту НИКИ. Сначала отвяжи его там, потом попробуй снова.",
    );
    return; // токен не гасим — пусть попробует после отвязки
  }

  // Коллизия B: у аккаунта уже есть активная связка с другим chat → заменяем.
  const now = new Date().toISOString();
  const { data: byUser } = await admin
    .from("tg_bindings")
    .select("id, chat_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (byUser && Number(byUser.chat_id) !== Number(chatId)) {
    await admin
      .from("tg_bindings")
      .update({ is_active: false, unlinked_at: now, unlink_reason: "relinked" })
      .eq("id", byUser.id);
  }

  // Создаём/реактивируем связку. chat_id уникален глобально → upsert по нему.
  const { error: upsertErr } = await admin.from("tg_bindings").upsert(
    {
      user_id: userId,
      chat_id: chatId,
      tg_username: ctx.from?.username ?? null,
      first_name: ctx.from?.first_name ?? null,
      is_active: true,
      linked_at: now,
      unlinked_at: null,
      unlink_reason: null,
    },
    { onConflict: "chat_id" },
  );
  if (upsertErr) {
    console.error("[tg-linking] upsert binding failed:", upsertErr.message);
    await ctx.reply("Не получилось привязать сейчас. Попробуй ещё раз чуть позже.");
    return;
  }

  // Гасим токен и обновляем зеркало users.telegram_id.
  await admin.from("tg_link_tokens").update({ used_at: now }).eq("token", token);
  await admin.from("users").update({ telegram_id: String(chatId) }).eq("id", userId);

  // Приветствие + запрос согласия (opt-in). Без согласия бот сам не пишет.
  await ctx.reply("Готово, привязала этот чат к твоему аккаунту НИКИ.");
  await sendConsentRequest(ctx);
}

/**
 * TODO (обратный путь, вторым приоритетом): бот выдаёт короткий код, пользователь
 * вводит его в настройках НИКИ. В первой версии не реализуем — deep-link из
 * приложения покрывает основной сценарий. Точка расширения:
 *   1) бот: команда /link → сгенерить короткий код, записать в tg_link_tokens
 *      (или отдельную таблицу) с привязкой к chat_id, показать код пользователю;
 *   2) веб: поле ввода кода в профиле → POST /api/telegram/link-code → находит
 *      код, ставит user_id текущего пользователя, активирует tg_bindings.
 * Коллизии обрабатываются так же, как в handleStartToken.
 */

/**
 * Ответ на opt-in. yes → tg_opt_in=true, tg_opt_in_at=now(); no → остаётся false.
 * answerCallbackQuery гасит «часик» на кнопке. Связку не трогаем.
 */
export async function handleOptIn(ctx: BotContext, yes: boolean): Promise<void> {
  const admin = tgAdmin();
  const chatId = ctx.from?.id;
  await ctx.answerCallbackQuery();
  if (chatId === undefined) return;

  const now = new Date().toISOString();
  await admin
    .from("tg_bindings")
    .update({ tg_opt_in: yes, tg_opt_in_at: yes ? now : null })
    .eq("chat_id", chatId)
    .eq("is_active", true);

  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
  await ctx.reply(
    yes
      ? "Здорово. Буду заглядывать по утрам, и всегда можно приостановить (команда /stop или настройки НИКИ)."
      : "Поняла, сама писать не буду. Включить можно в настройках НИКИ или командой /start заново.",
  );
}

/**
 * /stop — приостановка сообщений. tg_opt_in=false, связку НЕ рвём (в отличие от
 * unlink). Повторный opt-in доступен через /start или настройки.
 */
export async function handleStop(ctx: BotContext): Promise<void> {
  const admin = tgAdmin();
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;

  const { data: binding } = await admin
    .from("tg_bindings")
    .select("id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!binding) {
    await ctx.reply("Сейчас я тебе и так не пишу. Чтобы подключить меня, открой настройки НИКИ.");
    return;
  }

  await admin
    .from("tg_bindings")
    .update({ tg_opt_in: false, tg_opt_in_at: null })
    .eq("id", binding.id);

  await ctx.reply(
    "Приостановила. Сама писать не буду, но связку не разрываю. Включить обратно можно командой /start или в настройках НИКИ.",
  );
}

/** Активная связка по chat_id (для /start у уже привязанного). */
export async function findActiveBinding(
  chatId: number,
): Promise<{ id: string; tg_opt_in: boolean } | null> {
  const { data } = await tgAdmin()
    .from("tg_bindings")
    .select("id, tg_opt_in")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as { id: string; tg_opt_in: boolean } | null) ?? null;
}
