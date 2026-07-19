import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { trackServer } from "@/lib/track-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Отвязка Telegram. Помечает активную связку пользователя is_active=false
 * (unlink_reason='user') и чистит зеркало users.telegram_id. После этого
 * рассылка боту молчит (проверяет is_active + tg_opt_in). Повторная привязка
 * возможна заново — chat_id-строка при следующем /start реактивируется.
 */
export async function POST() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createServiceRoleClient();
  const now = new Date().toISOString();

  const { error } = await admin
    .from("tg_bindings")
    .update({ is_active: false, unlinked_at: now, unlink_reason: "user" })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (error) {
    console.error("[telegram/unlink] update failed:", error.message);
    return Response.json({ error: "DB error" }, { status: 500 });
  }

  // Зеркало на users.telegram_id — чистим (не критично, но держим консистентным).
  await admin.from("users").update({ telegram_id: null }).eq("id", user.id);

  trackServer(user.id, "tg_unlinked", { reason: "user" });
  return Response.json({ ok: true });
}
