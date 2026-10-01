import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { parseDiaryEntry, PRACTICES, isPracticeId } from "@/lib/v2/validate";
import { weekSummary } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лента дневника: записи, пробежки и пройденные практики одной хронологией,
 * частота меток и сводка текущей недели.
 */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { supabase, user } = authed;
  try {
    const [entries, runs, practices] = await Promise.all([
      supabase
        .from("diary_entries")
        .select("id, date, text, tags, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("runs")
        .select("*")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(60),
      supabase
        .from("practice_sessions")
        .select("id, practice_id, completed_at, listened_seconds")
        .eq("user_id", user.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(60),
    ]);
    if (entries.error || runs.error || practices.error) {
      return serverError("diary.get", entries.error ?? runs.error ?? practices.error);
    }

    const items = [
      ...(entries.data ?? []).map((e) => ({ kind: "entry" as const, id: e.id, at: e.created_at, date: e.date, text: e.text, tags: e.tags })),
      ...(runs.data ?? []).map((r) => ({
        kind: "run" as const,
        id: r.id,
        at: r.created_at,
        date: r.date,
        distanceKm: Number(r.distance_km),
        durationMin: r.duration_min,
        intensity: r.intensity,
        note: r.note,
        tags: r.tags ?? [],
        ratings: r.ratings,
      })),
      ...(practices.data ?? []).map((p) => ({
        kind: "practice" as const,
        id: p.id,
        at: p.completed_at as string,
        date: (p.completed_at as string).slice(0, 10),
        practiceId: p.practice_id,
        title: isPracticeId(p.practice_id) ? PRACTICES[p.practice_id].title : p.practice_id,
        seconds: p.listened_seconds,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    const tagCounts: Record<string, number> = {};
    for (const it of items) {
      if (it.kind === "practice") continue;
      for (const t of it.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }

    return Response.json(
      { items, tagCounts, week: weekSummary(runs.data ?? []) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return serverError("diary.get", err);
  }
}

/** Новая запись. Тело: { text, tags?, date? (YYYY-MM-DD по часам пользователя) }. */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  const entry = body && parseDiaryEntry(body);
  if (!entry) return badRequest("text");
  const { data, error } = await authed.supabase
    .from("diary_entries")
    .insert({ user_id: authed.user.id, ...entry })
    .select("id, date, text, tags, created_at")
    .single();
  if (error) return serverError("diary.post", error);
  return Response.json({ entry: data });
}

export async function DELETE(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id");
  const { error } = await authed.supabase.from("diary_entries").delete().eq("id", id).eq("user_id", authed.user.id);
  if (error) return serverError("diary.delete", error);
  return Response.json({ ok: true });
}
