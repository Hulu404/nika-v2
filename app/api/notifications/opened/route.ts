import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { validTimezone, localDate } from "@/lib/telegram/schedule";
import { trackServer } from "@/lib/track-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Атрибуция открытия утреннего нуджа (раздел 11 ТЗ). Дёргается КЛИЕНТОМ один раз
 * при заходе на экран чек-ина с ?src=tg_morning.
 *
 *  • проставляет notifications_log.clicked_at в строке за сегодня
 *    (user_id, type='morning', local_date в tz пользователя) — ТОЛЬКО первый клик
 *    (обновляем, пока clicked_at is null);
 *  • шлёт одно событие notification_opened в Amplitude через существующий
 *    серверный клиент trackServer (новый SDK не заводим).
 *
 * Пишем сервисным ключом (RLS: пользователь лог не пишет). Бизнес-логику чек-ина
 * НЕ трогаем — только атрибуция.
 */
export async function POST() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createServiceRoleClient();

  // Локальная дата пользователя той же tz, какой крон писал local_date.
  const { data: prefs } = await admin
    .from("notification_prefs")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  const tz = validTimezone(prefs?.timezone ?? null);
  const today = localDate(tz);

  // Первый клик: проставляем clicked_at там, где ещё пусто (повторно не перезаписываем).
  const { data: updated } = await admin
    .from("notifications_log")
    .update({ clicked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("type", "morning")
    .eq("local_date", today)
    .is("clicked_at", null)
    .select("id");

  // Событие открытия (без PII): канал/тип/источник — структурные значения.
  trackServer(user.id, "notification_opened", {
    channel: "telegram",
    type: "morning",
    src: "tg_morning",
  });

  return Response.json({ ok: true, attributed: (updated?.length ?? 0) > 0 });
}
