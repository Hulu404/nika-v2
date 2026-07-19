import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { siteKeyboard, siteUrl } from "./cta";
import { trackServer } from "../track-server";
import type { BotContext } from "./bot";

/**
 * /reset (и /password) — сброс пароля прямо из бота. Чат уже привязан к аккаунту,
 * значит мы можем сгенерировать recovery-ссылку для его email и прислать кнопкой.
 * Тот же механизм, что в app/api/auth/forgot (generateLink → /auth/confirm).
 *
 * ПРИВАТНОСТЬ: recovery-ссылку/токен в логи НЕ пишем.
 */
export async function handleResetCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;
  const admin = tgAdmin();

  // Только для привязанного чата (иначе не знаем, чей это аккаунт).
  const { data: binding } = await admin
    .from("tg_bindings")
    .select("user_id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!binding) {
    await ctx.reply(
      "Чтобы сбросить пароль отсюда, сначала подключи Telegram в профиле НИКИ. Либо запроси сброс на сайте.",
      withKeyboard(siteKeyboard("Открыть сайт")),
    );
    return;
  }

  const userId = (binding as { user_id: string }).user_id;
  const origin = siteUrl();

  const { data: userRow } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const email = (userRow as { email: string | null } | null)?.email ?? null;

  if (!email || !origin) {
    await ctx.reply(
      "Не получилось подготовить ссылку. Попробуй сбросить пароль на сайте.",
      withKeyboard(siteKeyboard("Открыть сайт")),
    );
    return;
  }

  const link = await buildRecoveryLink(admin, email, origin);
  if (!link) {
    await ctx.reply(
      "Не получилось подготовить ссылку сейчас. Попробуй ещё раз позже или на сайте.",
      withKeyboard(siteKeyboard("Открыть сайт")),
    );
    return;
  }

  const kb = new InlineKeyboard().url("Сбросить пароль", link);
  await ctx.reply(
    "Держи ссылку для смены пароля. Открой её и задай новый пароль. Если это был не ты, просто не открывай — с паролем ничего не случится.",
    { reply_markup: kb },
  );
  trackServer(userId, "password_reset_sent", { channel: "telegram" });
}

/** generateLink(recovery) → hashed_token → наш /auth/confirm. Ссылку не логируем. */
async function buildRecoveryLink(
  admin: ReturnType<typeof tgAdmin>,
  email: string,
  origin: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${origin}/reset-password` },
    });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) return null;
    return `${origin}/auth/confirm?token_hash=${hashed}&type=recovery&next=/reset-password`;
  } catch {
    return null;
  }
}

/** reply-опции с клавиатурой, только если она есть (без NEXT_PUBLIC_APP_URL — undefined). */
function withKeyboard(kb: InlineKeyboard | undefined) {
  return kb ? { reply_markup: kb } : undefined;
}
