import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { PRACTICES, isPracticeId } from "@/lib/v2/validate";

export const runtime = "nodejs";

/**
 * Прослушивание практики.
 * { action: "start", practiceId }            → { id }
 * { action: "progress", id, seconds, done? } → прослушано секунд; done отмечает завершение.
 * Завершённой считается практика, прослушанная на 90%+, или дослушанная до конца
 * при прослушанной половине. seconds это проигранное подряд, без перемоток.
 */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest();
  const { supabase, user } = authed;

  if (body.action === "start") {
    if (!isPracticeId(body.practiceId)) return badRequest("practiceId");
    const { data, error } = await supabase
      .from("practice_sessions")
      .insert({ user_id: user.id, practice_id: body.practiceId })
      .select("id")
      .single();
    if (error) return serverError("practice.start", error);
    return Response.json({ id: data.id });
  }

  if (body.action === "progress") {
    if (typeof body.id !== "string") return badRequest("id");
    const seconds = typeof body.seconds === "number" ? Math.max(0, Math.min(Math.round(body.seconds), 7200)) : 0;
    const { data: row, error: readErr } = await supabase
      .from("practice_sessions")
      .select("practice_id, completed_at, listened_seconds")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) return serverError("practice.read", readErr);
    if (!row) return badRequest("id");

    const total = isPracticeId(row.practice_id) ? PRACTICES[row.practice_id].seconds : 0;
    const listened = Math.max(row.listened_seconds, seconds);
    // Конец трека засчитывается, если прослушана хотя бы половина: перемотка в конец не считается.
    const done = (body.done === true && listened >= total * 0.5) || (total > 0 && listened >= total * 0.9);
    const patch: { listened_seconds: number; completed_at?: string } = { listened_seconds: listened };
    if (done && !row.completed_at) patch.completed_at = new Date().toISOString();

    const { error } = await supabase.from("practice_sessions").update(patch).eq("id", body.id).eq("user_id", user.id);
    if (error) return serverError("practice.progress", error);
    return Response.json({ ok: true, completed: done || !!row.completed_at });
  }

  return badRequest("action");
}
