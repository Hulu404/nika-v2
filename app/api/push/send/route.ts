import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { generatePushText } from "@/lib/push-generate";
import type { PushTrigger } from "@/lib/push-generate";
import type { Database } from "@/types/database";
import { dubToTelegram } from "@/lib/telegram/dub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function isSilentHour(notifTime: string | null): boolean {
  const [h] = (notifTime ?? "08:00").split(":").map(Number);
  const nowH = (new Date().getUTCHours() + 3) % 24; // MSK approx
  return nowH < h - 1 || nowH >= 22;
}

function isDue(frequency: string | null, lastSentAt: string | null): boolean {
  if (!lastSentAt) return true;
  const hours = (Date.now() - new Date(lastSentAt).getTime()) / 3_600_000;
  switch (frequency ?? "daily") {
    case "daily":           return hours >= 23;
    case "every_other_day": return hours >= 47;
    case "weekdays": {
      const day = new Date().getDay();
      return day >= 1 && day <= 5 && hours >= 23;
    }
    case "weekly":   return hours >= 167;
    case "biweekly": return hours >= 335;
    case "monthly":  return hours >= 719;
    default:         return false;
  }
}

export async function GET(req: Request) {
  // Vercel Cron сам добавляет заголовок `Authorization: Bearer <CRON_SECRET>`
  // (кастомные заголовки в vercel.json недоступны). Поддерживаем и его, и
  // ручной вызов через `x-cron-secret` — для локальных/отладочных прогонов.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const legacyHeader = req.headers.get("x-cron-secret");
  const authorized =
    !!secret && (authHeader === `Bearer ${secret}` || legacyHeader === secret);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pubKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privKey = process.env.VAPID_PRIVATE_KEY;
  if (!pubKey || !privKey) {
    return Response.json({ error: "VAPID keys not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL ?? "mailto:ceo@mynika.ru",
    pubKey,
    privKey,
  );

  const db = adminClient();
  const now = new Date();

  // Все активные push-подписки
  const { data: subs } = await db.from("push_subscriptions").select("*");
  if (!subs?.length) return Response.json({ sent: 0 });

  let sent = 0;
  let dubbed = 0; // сколько уведомлений продублировано в Telegram
  const errors: string[] = [];

  for (const sub of subs) {
    // Профиль пользователя
    const { data: profile } = await db
      .from("profiles")
      .select("proactive, notif_time, notif_frequency, gender, last_push_sent_at")
      .eq("user_id", sub.user_id)
      .maybeSingle();

    if (!profile?.proactive) continue;
    if (isSilentHour(profile.notif_time)) continue;

    // Последний диалог → daysSinceLogin
    const { data: lastConv } = await db
      .from("conversations")
      .select("updated_at")
      .eq("user_id", sub.user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const daysSinceLogin = lastConv?.updated_at
      ? Math.floor((now.getTime() - new Date(lastConv.updated_at).getTime()) / 86_400_000)
      : 999;

    const isInactive = daysSinceLogin >= 5;
    const trigger: PushTrigger = isInactive ? "inactive" : "scheduled";

    if (!isInactive && !isDue(profile.notif_frequency, profile.last_push_sent_at)) continue;

    // Имя пользователя
    const { data: userData } = await db
      .from("users")
      .select("display_name")
      .eq("id", sub.user_id)
      .maybeSingle();

    // Последняя пробежка
    const { data: lastRun } = await db
      .from("runs")
      .select("date")
      .eq("user_id", sub.user_id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const daysSinceRun = lastRun?.date
      ? Math.floor((now.getTime() - new Date(lastRun.date).getTime()) / 86_400_000)
      : undefined;

    // Активный спринт
    const { data: sprint } = await db
      .from("sprints")
      .select("start_date, goal_text")
      .eq("user_id", sub.user_id)
      .eq("status", "active")
      .maybeSingle();

    const sprintDay = sprint?.start_date
      ? Math.floor((now.getTime() - new Date(sprint.start_date).getTime()) / 86_400_000) + 1
      : undefined;

    const gender = (profile.gender ?? "neutral") as "male" | "female" | "neutral";

    try {
      const { title, body } = await generatePushText({
        trigger,
        name: userData?.display_name ?? "",
        gender,
        daysSinceRun,
        daysSinceLogin: isInactive ? daysSinceLogin : undefined,
        sprintDay,
        sprintGoal: sprint?.goal_text ?? undefined,
      });

      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url: "/" }),
      );

      await db
        .from("profiles")
        .update({ last_push_sent_at: now.toISOString() })
        .eq("user_id", sub.user_id);

      sent++;

      // Пуш-дубль в Telegram (гейт opt-in внутри, ошибки изолированы).
      if (await dubToTelegram(sub.user_id, `${title}\n${body}`)) dubbed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("410")) {
        await db.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        errors.push(`${sub.user_id}: ${msg}`);
      }
    }
  }

  return Response.json({ sent, dubbed, errors: errors.length ? errors : undefined });
}
