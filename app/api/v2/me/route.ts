import { getAuthed, serverError } from "@/lib/v2/http";
import { buildMe } from "@/lib/v2/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Всё, что нужно приложению при запуске: профиль, план, согласия, счётчики.
 * Гостю отвечает 200 { auth: false }: это нормальное состояние, а не ошибка.
 */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return Response.json({ auth: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ auth: true, ...(await buildMe(authed.supabase, authed.user)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("me", err);
  }
}
