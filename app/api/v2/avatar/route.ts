import { getAuthed, unauthorized, badRequest, serverError } from "@/lib/v2/http";
import { parseAvatar } from "@/lib/v2/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "avatars";
const MAX_BYTES = 200 * 1024; // клиент сжимает до 150 КБ, сервер оставляет запас
const TYPES: Record<string, string> = { "image/webp": "avatar.webp", "image/jpeg": "avatar.jpg" };

/** Своё фото пользователя. Отдаётся только владельцу (сессия + RLS бакета). */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { data: p } = await authed.supabase.from("profiles").select("avatar_url").eq("user_id", authed.user.id).maybeSingle();
  const a = parseAvatar(p?.avatar_url);
  if (!a || a.kind !== "photo") return new Response(null, { status: 404 });
  const { data, error } = await authed.supabase.storage.from(BUCKET).download(a.path);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(data, {
    headers: { "Content-Type": data.type || "image/webp", "Cache-Control": "private, max-age=86400" },
  });
}

/**
 * Сохранить аватар.
 * - тело image/webp или image/jpeg (до 200 КБ): своё фото, путь {user_id}/avatar.webp|jpg;
 * - JSON { preset: 1..8 }: готовый аватар.
 */
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { supabase, user } = authed;
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();

  let value: string;
  if (type === "application/json") {
    const body = (await req.json().catch(() => null)) as { preset?: unknown } | null;
    const n = body?.preset;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 8) return badRequest("preset");
    value = `preset:${n}`;
  } else {
    const file = TYPES[type];
    if (!file) return badRequest("type");
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return badRequest("size");
    const path = `${user.id}/${file}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true });
    if (error) return serverError("avatar.upload", error);
    value = `photo:${path}?v=${Date.now()}`;
  }
  const { error } = await supabase.from("profiles").upsert({ user_id: user.id, avatar_url: value }, { onConflict: "user_id" });
  if (error) return serverError("avatar.profile", error);
  return Response.json({ ok: true, avatar: value });
}

/** Убрать фото: файл удаляется, остаётся буква имени. */
export async function DELETE() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { supabase, user } = authed;
  await supabase.storage.from(BUCKET).remove([`${user.id}/avatar.webp`, `${user.id}/avatar.jpg`]);
  const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("user_id", user.id);
  if (error) return serverError("avatar.delete", error);
  return Response.json({ ok: true });
}
