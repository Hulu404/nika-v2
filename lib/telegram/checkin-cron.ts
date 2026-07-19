import { tgAdmin } from "./supabase";
import { listBotRecipients } from "./gate";
import { sendCheckin } from "./checkin";
import {
  shouldSendCheckin,
  localParts,
  validTimezone,
  MORNING_HOURS,
} from "./schedule";

/**
 * Автоматическая утренняя рассылка чек-инов (раздел 9 ТЗ).
 * Запускается часто (крон ежечасно), «утро» определяется по локальной таймзоне
 * пользователя. Отбор — гейт opt-in + правила частоты (shouldSendCheckin).
 * Троттлинг под лимиты Telegram; ошибки изолированы, тик не падает.
 */

const THROTTLE_MS = 1100; // ~1 msg/sec на чат
const MAX_PER_TICK = 40; // граница длительности тика (maxDuration 60s); остаток — следующий час

export interface CheckinDispatchResult {
  candidates: number;
  morning: number;
  sent: number;
  skipped: number;
  failed: number;
  blocked: number;
  throttled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Запись результата в notification_log (без тела сообщения и chat_id). Изолирована. */
async function logNotif(userId: string, status: string, detail?: string): Promise<void> {
  try {
    await tgAdmin().from("notification_log").insert({
      user_id: userId,
      channel: "telegram",
      type: "checkin",
      status,
      detail: detail ?? null,
    });
  } catch {
    /* лог не критичен */
  }
}

export async function runCheckinDispatch(): Promise<CheckinDispatchResult> {
  const admin = tgAdmin();
  const recipients = await listBotRecipients(); // is_active && tg_opt_in
  const res: CheckinDispatchResult = {
    candidates: recipients.length,
    morning: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    blocked: 0,
    throttled: false,
  };

  let processed = 0;

  for (const r of recipients) {
    // Ограничиваем длительность тика: остаток разошлётся на следующем часе.
    if (processed >= MAX_PER_TICK) {
      res.throttled = true;
      break;
    }

    // Таймзона пользователя (TODO собрать tz; дефолт — Москва).
    const { data: prefs } = await admin
      .from("notification_prefs")
      .select("timezone")
      .eq("user_id", r.user_id)
      .maybeSingle();
    const tz = validTimezone((prefs as { timezone?: string | null } | null)?.timezone);
    const { hour, weekday, ymd } = localParts(tz);

    // Шлём только тем, у кого сейчас локально утро.
    if (!MORNING_HOURS.includes(hour)) continue;
    res.morning++;

    // Недавние чек-ины: дедуп «сегодня» (по локальной дате) + адаптивная частота.
    const { data: recent } = await admin
      .from("checkins")
      .select("asked_at, answer")
      .eq("user_id", r.user_id)
      .order("asked_at", { ascending: false })
      .limit(5);
    const rows = (recent ?? []) as { asked_at: string; answer: string | null }[];
    const askedToday = rows.some((c) => localParts(tz, new Date(c.asked_at)).ymd === ymd);
    const recentAnswers = rows.map((c) => c.answer);

    if (!shouldSendCheckin({ weekday, askedToday, recentAnswers })) {
      res.skipped++;
      continue;
    }

    // Отправка (гейт + дедуп «за сегодня по UTC» дублируются внутри sendCheckin).
    const out = await sendCheckin(r.user_id);
    processed++;

    if (out.sent) {
      res.sent++;
      await logNotif(r.user_id, "sent");
    } else if (out.reason === "blocked") {
      // 403 — связка уже деактивирована в транспорте (unlink_reason='blocked').
      res.blocked++;
      await logNotif(r.user_id, "blocked", "403");
    } else if (out.retryAfter != null) {
      // 429 — глобальный rate limit: прекращаем тик, повтор на следующем часе.
      res.failed++;
      await logNotif(r.user_id, "failed", `429 retry_after=${out.retryAfter}`);
      res.throttled = true;
      break;
    } else if (out.reason === "already_open" || out.reason === "not_opted_in") {
      res.skipped++;
    } else {
      res.failed++;
      await logNotif(r.user_id, "failed", out.reason ?? "send_failed");
    }

    await sleep(THROTTLE_MS); // троттлинг ~1 msg/sec
  }

  return res;
}
