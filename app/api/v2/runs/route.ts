import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { parseRun } from "@/lib/v2/validate";

export const runtime = "nodejs";

/** Пробежка с экрана «после пробежки»: дистанция, время, оценки, метки, строка текста. */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  const run = body && parseRun(body);
  if (!run) return badRequest("run");
  const { data, error } = await authed.supabase
    .from("runs")
    .insert({ user_id: authed.user.id, ...run })
    .select("id")
    .single();
  if (error) return serverError("runs.post", error);
  return Response.json({ id: data.id });
}

export async function DELETE(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id");
  const { error } = await authed.supabase.from("runs").delete().eq("id", id).eq("user_id", authed.user.id);
  if (error) return serverError("runs.delete", error);
  return Response.json({ ok: true });
}
