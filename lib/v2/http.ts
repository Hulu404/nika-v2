import "server-only";
import type { User } from "@supabase/supabase-js";
import { createServerComponentClient } from "@/lib/supabase";

export type ServerClient = Awaited<ReturnType<typeof createServerComponentClient>>;

/** Клиент с сессией из cookie и текущий пользователь; null, если сессии нет или она протухла. */
export async function getAuthed(): Promise<{ supabase: ServerClient; user: User } | null> {
  const supabase = await createServerComponentClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { supabase, user: data.user };
  } catch {
    return null;
  }
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
export const badRequest = (error = "invalid_body", extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status: 400 });
export const serverError = (where: string, err: unknown) => {
  console.error(`[api/v2] ${where}:`, err instanceof Error ? err.message : err);
  return Response.json({ error: "server_error" }, { status: 500 });
};

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
