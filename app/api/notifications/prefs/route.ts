import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";
import type { Database } from "@/types/database";

type PrefsInsert = Database["public"]["Tables"]["notification_prefs"]["Insert"];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Настройки утреннего нуджа (notification_prefs): morning_enabled, morning_time,
 * timezone, pause_until. Апсерт сервисным ключом — у notification_prefs есть RLS
 * UPDATE владельцу, но нет INSERT, а строки может ещё не быть. Пишем только свою
 * строку (по auth.uid()). Крон (Промт 4) читает ровно эти поля.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Валидна ли IANA-таймзона (через Intl). */
function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** pause_until: null | дата не в прошлом (лениво к UTC — допускаем «вчера» под tz). */
function checkPause(v: unknown): { ok: boolean; value?: string | null } {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string" || !DATE_RE.test(v)) return { ok: false };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false };
  const floor = new Date();
  floor.setUTCHours(0, 0, 0, 0);
  floor.setUTCDate(floor.getUTCDate() - 1); // запас на таймзоны
  if (d < floor) return { ok: false };
  return { ok: true, value: v };
}

export async function GET() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("notification_prefs")
    .select("morning_enabled, morning_time, timezone, pause_until")
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({
    morning_enabled: data?.morning_enabled ?? true,
    morning_time: (data?.morning_time as string | null)?.slice(0, 5) ?? "08:00",
    timezone: data?.timezone ?? null,
    pause_until: data?.pause_until ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: PrefsInsert = { user_id: user.id };

  if ("morning_enabled" in body) patch.morning_enabled = Boolean(body.morning_enabled);

  if ("morning_time" in body && body.morning_time != null) {
    if (typeof body.morning_time !== "string" || !TIME_RE.test(body.morning_time)) {
      return Response.json({ error: "Invalid morning_time" }, { status: 400 });
    }
    patch.morning_time = body.morning_time;
  }

  // timezone: молча определяется клиентом через Intl. Битую не пишем (у крона
  // есть фолбэк на Europe/Moscow), но и весь запрос из-за неё не роняем.
  if ("timezone" in body && typeof body.timezone === "string" && isValidTz(body.timezone)) {
    patch.timezone = body.timezone;
  }

  if ("pause_until" in body) {
    const p = checkPause(body.pause_until);
    if (!p.ok) return Response.json({ error: "Invalid pause_until" }, { status: 400 });
    patch.pause_until = p.value;
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("notification_prefs")
    .upsert(patch, { onConflict: "user_id" });
  if (error) return Response.json({ error: "DB error" }, { status: 500 });

  const { user_id: _omit, ...saved } = patch;
  void _omit;
  return Response.json({ ok: true, ...saved });
}
