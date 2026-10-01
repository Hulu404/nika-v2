import { getAuthed, unauthorized, serverError } from "@/lib/v2/http";
import type { Message } from "@/types/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Сколько времени после последней реплики разговор продолжается, а не начинается заново. */
const CONTINUE_MS = 48 * 3600 * 1000;

/**
 * Последний разговор для листа Ники: если ему меньше двух суток, приложение
 * продолжает его; иначе начинает новый (conversation: null).
 */
export async function GET() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { data, error } = await authed.supabase
    .from("conversations")
    .select("id, scenario, messages, updated_at")
    .eq("user_id", authed.user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return serverError("chat.get", error);
  if (!data || Date.now() - new Date(data.updated_at).getTime() > CONTINUE_MS) {
    return Response.json({ conversation: null }, { headers: { "Cache-Control": "no-store" } });
  }
  const messages = ((data.messages as Message[]) ?? []).slice(-40).map((m) => ({
    role: m.role,
    content: m.content,
    at: m.timestamp ?? null,
  }));
  return Response.json(
    { conversation: { id: data.id, scenario: data.scenario, messages } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
