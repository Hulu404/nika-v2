import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { parseProfilePatch } from "@/lib/v2/validate";

export const runtime = "nodejs";

/**
 * Правка профиля и сохранение онбординга. Поля необязательны.
 * finish: true отмечает, что новый онбординг пройден.
 */
export async function PATCH(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest();

  const { patch, errors } = parseProfilePatch(body);
  if (errors.length) return badRequest("invalid_fields", { fields: errors });
  const { supabase, user } = authed;

  try {
    if (patch.name !== undefined) {
      const { error } = await supabase.from("users").update({ display_name: patch.name || null }).eq("id", user.id);
      if (error) return serverError("profile.name", error);
    }
    const { name: _name, ...rest } = patch;
    const row: Record<string, unknown> = { ...rest };
    if (body.finish === true) row.onboarded_at = new Date().toISOString();
    if (Object.keys(row).length) {
      const { error } = await supabase.from("profiles").upsert({ user_id: user.id, ...row }, { onConflict: "user_id" });
      if (error) return serverError("profile.upsert", error);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("profile", err);
  }
}
