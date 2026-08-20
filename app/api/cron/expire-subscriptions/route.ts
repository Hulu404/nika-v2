import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ежедневный крон: снимает is_pro у пользователей, у которых истёк
 * current_period_end в subscriptions.
 *
 * Применяется ко ВСЕМ подпискам — и промо, и оплаченным Robokassa.
 * Это первый механизм истечения подписки в проекте.
 *
 * Вызывается Railway Cron или внешним планировщиком с CRON_SECRET в заголовке.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const now = new Date().toISOString();

  // Находим все активные подписки с истёкшим периодом
  const { data: expired, error: fetchErr } = await admin
    .from("subscriptions")
    .select("id, user_id")
    .eq("status", "active")
    .lt("current_period_end", now)
    .not("current_period_end", "is", null);

  if (fetchErr) {
    console.error("[expire-subscriptions] fetch error:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ expired: 0 });
  }

  const userIds = expired.map((s) => s.user_id);
  const subIds  = expired.map((s) => s.id);

  // Обновляем статус подписок → expired
  const { error: subErr } = await admin
    .from("subscriptions")
    .update({ status: "expired", updated_at: now })
    .in("id", subIds);

  if (subErr) {
    console.error("[expire-subscriptions] sub update error:", subErr.message);
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  // Снимаем is_pro — только если у пользователя нет другой активной подписки
  // (например, если одновременно существует оплаченная)
  const { data: stillActive } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("status", "active")
    .in("user_id", userIds);

  const stillActiveSet = new Set((stillActive ?? []).map((s) => s.user_id));
  const toDowngrade = userIds.filter((uid) => !stillActiveSet.has(uid));

  if (toDowngrade.length > 0) {
    await admin
      .from("users")
      .update({ is_pro: false })
      .in("id", toDowngrade);
  }

  console.log(`[expire-subscriptions] expired=${expired.length} downgraded=${toDowngrade.length}`);
  return NextResponse.json({ expired: expired.length, downgraded: toDowngrade.length });
}
