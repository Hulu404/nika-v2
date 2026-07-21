import { InlineKeyboard } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tgAdmin } from "@/lib/telegram/supabase";
import { listBotRecipients } from "@/lib/telegram/gate";
import { sendBotMessage } from "@/lib/telegram/send";
import { validTimezone, localParts } from "@/lib/telegram/schedule";
import { isPora, isQuiet, isPaused } from "@/lib/telegram/morning-schedule";
import { buildMorningMessage, type MorningMessage } from "@/lib/telegram/morning-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Крон утреннего pure-push нуджа (разделы 4, 6 ТЗ). Vercel Cron дёргает каждые
 * ~15 мин (vercel.json); «утро» определяется по ЛОКАЛЬНОЙ таймзоне каждой
 * пользовательницы, поэтому один тик обрабатывает только тех, у кого сейчас окно.
 *
 * Идемпотентность — слот-инсерт в notifications_log (unique user_id+type+
 * local_date): один нудж в день, повторный тик не задваивает. Проверки перед
 * отправкой — opt-in (гейт), morning_enabled, пауза, тихие часы, дедуп по
 * checkins. ?dryRun=1 — считает и собирает, но не пишет лог и не шлёт.
 *
 * Авторизация как у пуш-крона: Authorization: Bearer $CRON_SECRET (или legacy
 * x-cron-secret). ПРИВАТНОСТЬ: тела сообщений и chat_id в лог не пишем.
 */

const MORNING_TYPE = "morning";

/** local_date окно ~40ч назад — хватает, чтобы поймать «сегодня» в любой tz. */
const CHECKIN_LOOKBACK_MS = 40 * 60 * 60 * 1000;

type PrefsRow = {
  user_id: string;
  timezone: string | null;
  morning_enabled: boolean | null;
  morning_time: string | null;
  pause_until: string | null;
  quiet_hours: { start?: string | null; end?: string | null } | null;
};

/** reply_markup (Bot API форма) → grammy InlineKeyboard для транспорта. */
function toKeyboard(rm: MorningMessage["reply_markup"]): InlineKeyboard | undefined {
  if (!rm) return undefined;
  const kb = new InlineKeyboard();
  rm.inline_keyboard.forEach((row, i) => {
    if (i > 0) kb.row();
    for (const b of row) kb.url(b.text, b.url);
  });
  return kb;
}

/** Есть ли у пользователя чек-ин за СЕГОДНЯ по локальной дате (source не важен). */
async function hasCheckinToday(
  admin: SupabaseClient,
  userId: string,
  tz: string,
  todayYmd: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - CHECKIN_LOOKBACK_MS).toISOString();
  const { data } = await admin
    .from("checkins")
    .select("asked_at")
    .eq("user_id", userId)
    .gte("asked_at", since)
    .order("asked_at", { ascending: false })
    .limit(20);
  for (const c of (data ?? []) as { asked_at: string }[]) {
    if (localParts(tz, new Date(c.asked_at)).ymd === todayYmd) return true;
  }
  return false;
}

/** Прошлый вариант формулировки пользователя (для ротации). */
async function lastVariant(admin: SupabaseClient, userId: string): Promise<string | undefined> {
  const { data } = await admin
    .from("notifications_log")
    .select("question_variant")
    .eq("user_id", userId)
    .not("question_variant", "is", null)
    .order("local_date", { ascending: false })
    .limit(1);
  return (data?.[0] as { question_variant?: string } | undefined)?.question_variant ?? undefined;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const legacyHeader = req.headers.get("x-cron-secret");
  const authorized =
    !!secret && (authHeader === `Bearer ${secret}` || legacyHeader === secret);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const admin = tgAdmin();
  const now = new Date();

  // Кандидаты: активная связка + opt-in (единый гейт). chat_id уже здесь.
  const recipients = await listBotRecipients();

  const summary = {
    dryRun,
    candidates: recipients.length,
    due: 0, // прошли окно «пора»
    sent: 0,
    failed: 0,
    skipped_dedup: 0,
    skipped_prefs: 0,
  };
  const preview: { user_id: string; outcome: string; variant?: string }[] = [];

  // Настройки пачкой.
  const prefsByUser = new Map<string, PrefsRow>();
  if (recipients.length) {
    const { data: prefsRows } = await admin
      .from("notification_prefs")
      .select("user_id, timezone, morning_enabled, morning_time, pause_until, quiet_hours")
      .in("user_id", recipients.map((r) => r.user_id));
    for (const p of (prefsRows ?? []) as PrefsRow[]) prefsByUser.set(p.user_id, p);
  }

  for (const r of recipients) {
    const prefs = prefsByUser.get(r.user_id);
    const tz = validTimezone(prefs?.timezone);
    const { hour, minuteOfDay, ymd } = localParts(tz, now);
    const morningTime = prefs?.morning_time ?? "08:00";

    // Не «утро» этой пользовательницы прямо сейчас → тихо пропускаем (без лога).
    if (!isPora(minuteOfDay, morningTime)) continue;
    summary.due++;

    // Проверки по порядку; первая непройденная задаёт статус.
    const morningEnabled = prefs?.morning_enabled !== false; // дефолт true
    let outcome: "skipped_prefs" | "skipped_dedup" | "send";
    if (!morningEnabled) outcome = "skipped_prefs";
    else if (isPaused(prefs?.pause_until, ymd)) outcome = "skipped_prefs";
    else if (isQuiet(hour, minuteOfDay, prefs?.quiet_hours)) outcome = "skipped_prefs";
    else if (await hasCheckinToday(admin, r.user_id, tz, ymd, now)) outcome = "skipped_dedup";
    else outcome = "send";

    if (dryRun) {
      const variant =
        outcome === "send"
          ? buildMorningMessage(r.user_id, await lastVariant(admin, r.user_id)).variant
          : undefined;
      preview.push({ user_id: r.user_id, outcome, variant });
      if (outcome === "send") summary.sent++;
      else summary[outcome]++;
      continue;
    }

    // Пропуски: занимаем слот статусом (идемпотентно), не шлём.
    if (outcome !== "send") {
      await admin
        .from("notifications_log")
        .upsert(
          { user_id: r.user_id, type: MORNING_TYPE, local_date: ymd, status: outcome },
          { onConflict: "user_id,type,local_date", ignoreDuplicates: true },
        );
      summary[outcome]++;
      continue;
    }

    // Отправка: слот-инсерт 'sent' on conflict do nothing returning id.
    const { data: slot } = await admin
      .from("notifications_log")
      .upsert(
        { user_id: r.user_id, type: MORNING_TYPE, local_date: ymd, status: "sent" },
        { onConflict: "user_id,type,local_date", ignoreDuplicates: true },
      )
      .select("id");
    // Нет returning-строки → сегодня уже отправлено/в работе другим тиком.
    if (!slot || slot.length === 0) continue;
    const rowId = (slot[0] as { id: string }).id;

    const lv = await lastVariant(admin, r.user_id);
    const msg = buildMorningMessage(r.user_id, lv);
    const res = await sendBotMessage(r.chat_id, msg.text, toKeyboard(msg.reply_markup));

    if (res.ok) {
      await admin
        .from("notifications_log")
        .update({ sent_at: new Date().toISOString(), question_variant: msg.variant, status: "sent" })
        .eq("id", rowId);
      summary.sent++;
    } else {
      // Обработку конкретных ошибок доставки доводит Промт 5; тут — код в лог.
      const err = res.blocked ? "403" : res.retryAfter != null ? `429:${res.retryAfter}` : "send_failed";
      await admin.from("notifications_log").update({ status: "failed", error: err }).eq("id", rowId);
      summary.failed++;
    }
  }

  return Response.json(dryRun ? { ...summary, preview } : summary);
}
