import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";
import { PASSWORD_MIN } from "@/lib/v2/validate";

export const runtime = "nodejs";

/**
 * Новый пароль. Сессию даёт ссылка из письма сброса (/auth/confirm, type=recovery),
 * после неё пользователь попадает на /start?reset=1.
 */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < PASSWORD_MIN || password.length > 72) return badRequest("password");
  const { error } = await authed.supabase.auth.updateUser({ password });
  if (error) {
    if ((error as { code?: string }).code === "same_password") return badRequest("same_password");
    return serverError("password", error);
  }
  return Response.json({ ok: true });
}
