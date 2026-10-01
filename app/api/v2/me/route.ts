import { getAuthed, unauthorized, serverError } from "@/lib/v2/http";
import { buildMe } from "@/lib/v2/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Всё, что нужно приложению при запуске: профиль, план, согласия, счётчики. */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  try {
    return Response.json(await buildMe(authed.supabase, authed.user), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("me", err);
  }
}
