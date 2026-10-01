import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { hasConsent } from "@/lib/consents";
import { getLatestCycles, getCycleLength, getCycleDay, getPhase, markCycleStart } from "@/lib/rhythm/cycles";
import { isYmd } from "@/lib/v2/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Дата начала: не в будущем и не раньше чем 90 дней назад. */
function validStart(v: unknown, today: string): v is string {
  if (!isYmd(v) || v > today) return false;
  const min = new Date(today + "T00:00:00Z");
  min.setUTCDate(min.getUTCDate() - 90);
  return v >= min.toISOString().slice(0, 10);
}

/** Состояние раздела. Без согласия на сведения о здоровье данные не отдаются. */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { supabase, user } = authed;
  try {
    if (!(await hasConsent(supabase, user.id, "health"))) {
      return Response.json({ consent: false }, { headers: { "Cache-Control": "no-store" } });
    }
    const cycles = await getLatestCycles(supabase, user.id, 5);
    if (cycles.length === 0) return Response.json({ consent: true, cycle: null });
    const today = todayUtc();
    const length = getCycleLength(cycles);
    const day = getCycleDay(cycles[0].started_at, today);
    return Response.json(
      {
        consent: true,
        cycle: {
          startedAt: cycles[0].started_at,
          length,
          day,
          phase: getPhase(day, length),
          overdue: day > length + 7,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return serverError("rhythm.get", err);
  }
}

/**
 * { action: "start", startedAt, cycleLength? } отмечает начало цикла (первое или новое).
 * { action: "edit", startedAt } поправляет дату последнего начала.
 */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { supabase, user } = authed;
  if (!(await hasConsent(supabase, user.id, "health"))) {
    return Response.json({ error: "health_consent_required" }, { status: 403 });
  }
  const body = await readJson(req);
  if (!body) return badRequest();
  const today = todayUtc();
  if (!validStart(body.startedAt, today)) return badRequest("startedAt");
  const startedAt = body.startedAt;

  try {
    const cycles = await getLatestCycles(supabase, user.id, 2);
    if (body.action === "edit") {
      if (!cycles[0]) return badRequest("no_cycle");
      const { error } = await supabase
        .from("rhythm_cycles")
        .update({ started_at: startedAt })
        .eq("id", cycles[0].id)
        .eq("user_id", user.id);
      if (error) return serverError("rhythm.edit", error);
      return Response.json({ ok: true });
    }
    if (body.action !== "start") return badRequest("action");

    if (cycles.length === 0) {
      const len =
        typeof body.cycleLength === "number" && body.cycleLength >= 21 && body.cycleLength <= 42
          ? Math.round(body.cycleLength)
          : 28;
      const { error } = await supabase
        .from("rhythm_cycles")
        .insert({ user_id: user.id, started_at: startedAt, cycle_length: len });
      if (error) return serverError("rhythm.first", error);
      return Response.json({ ok: true });
    }
    if (startedAt <= cycles[0].started_at) return badRequest("startedAt");
    const err = await markCycleStart(supabase, user.id, startedAt, cycles[0].id, cycles[0].started_at);
    if (err) return serverError("rhythm.start", err);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("rhythm.post", err);
  }
}
