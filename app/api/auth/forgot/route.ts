import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { InlineKeyboard } from "grammy";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { sendBotMessage } from "@/lib/telegram/send";
import { canReceiveBotMessages } from "@/lib/telegram/gate";
import { trackServer } from "@/lib/track-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Запрос на сброс пароля (раздел 6 ТЗ). Приоритетный канал — Telegram (быстро),
 * фолбэк — email. Email-флоу не ломаем.
 *
 * НЕ раскрываем существование аккаунта: ответ ВСЕГДА одинаково-нейтральный.
 * Recovery-ссылку/токен в логи НЕ пишем.
 */
const NEUTRAL = {
  message: "Если аккаунт с такой почтой есть, мы пришлём ссылку для сброса пароля. Загляни в Telegram и в почту.",
};

/** Строит ссылку на наш /auth/confirm из hashed_token (verifyOtp recovery). */
async function buildRecoveryLink(
  admin: ReturnType<typeof createServiceRoleClient>,
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

/** Обычный email-флоу (нативное письмо Supabase → шаблон ведёт на /auth/confirm). */
async function sendRecoveryEmail(email: string, origin: string): Promise<void> {
  const anon: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await anon.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
}

export async function POST(req: Request) {
  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    return Response.json(NEUTRAL); // нейтрально даже на битый ввод
  }
  if (!email) return Response.json(NEUTRAL);

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const admin = createServiceRoleClient();

  try {
    // Резолвим пользователя по email (public.users зеркалит auth email).
    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!userRow) return Response.json(NEUTRAL); // не раскрываем отсутствие

    // Активная привязка с согласием?
    const { data: binding } = await admin
      .from("tg_bindings")
      .select("chat_id, is_active, tg_opt_in")
      .eq("user_id", userRow.id)
      .eq("is_active", true)
      .maybeSingle();

    let deliveredViaTg = false;
    if (canReceiveBotMessages(binding)) {
      const link = await buildRecoveryLink(admin, email, origin);
      if (link) {
        const kb = new InlineKeyboard().url("Сбросить пароль", link);
        const res = await sendBotMessage(
          Number((binding as { chat_id: number | string }).chat_id),
          "Пришёл запрос на смену пароля для твоего аккаунта в НИКЕ. Если это ты — нажми кнопку ниже. Если нет, просто не открывай, с паролем ничего не случится.",
          kb,
        );
        // 403 (бот заблокирован) транспорт уже погасил связку → уходим на email.
        deliveredViaTg = res.ok;
      }
    }

    if (deliveredViaTg) {
      trackServer(userRow.id, "password_reset_sent", { channel: "telegram" });
    } else {
      await sendRecoveryEmail(email, origin); // фолбэк / нет привязки
      trackServer(userRow.id, "password_reset_sent", { channel: "email" });
    }
  } catch (err) {
    // Никаких ссылок/токенов в лог — только факт ошибки.
    console.error("[auth/forgot] error, fallback email:", err instanceof Error ? err.message : "unknown");
    try {
      await sendRecoveryEmail(email, origin);
    } catch {
      /* всё равно отвечаем нейтрально */
    }
  }

  return Response.json(NEUTRAL);
}
