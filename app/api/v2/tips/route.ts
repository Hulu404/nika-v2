import { getAuthed, unauthorized, badRequest, serverError } from "@/lib/v2/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Советы, которые Ника сохранила из разговоров. */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { data, error } = await authed.supabase
    .from("personal_tips")
    .select("id, title, body, category, created_at")
    .eq("user_id", authed.user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return serverError("tips.get", error);
  return Response.json({ tips: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

/** Убрать совет (мягкое удаление, как в старом разделе «Советы»). */
export async function DELETE(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id");
  const { error } = await authed.supabase
    .from("personal_tips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", authed.user.id);
  if (error) return serverError("tips.delete", error);
  return Response.json({ ok: true });
}
