import { randomBytes } from "node:crypto";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { isTelegramAllowed } from "@/lib/telegram/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_MS = 10 * 60_000; // 10 минут

/**
 * Минт одноразового токена связки Telegram (веб → бот).
 * Возвращает deep-link t.me/<bot>?start=<token>. Если у пользователя уже есть
 * активная связка — возвращает { linked: true } (UI покажет «Отключить»).
 *
 * ВАЖНО: сам token не логируем.
 */
export async function POST() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Тест-режим: привязка Telegram открыта только пользователям из allowlist.
  if (!isTelegramAllowed(user.email)) {
    return Response.json({ error: "Not available yet" }, { status: 403 });
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    return Response.json({ error: "Bot username not configured" }, { status: 500 });
  }

  const admin = createServiceRoleClient();

  // Уже есть активная связка? Тогда минтить токен не нужно.
  const { data: binding } = await admin
    .from("tg_bindings")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (binding) {
    return Response.json({ linked: true });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error } = await admin.from("tg_link_tokens").insert({
    token,
    user_id: user.id,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[telegram/link] insert token failed:", error.message);
    return Response.json({ error: "DB error" }, { status: 500 });
  }

  return Response.json({
    linked: false,
    url: `https://t.me/${botUsername}?start=${token}`,
  });
}
