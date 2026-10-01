import { createServerComponentClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createServerComponentClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // сессии могло уже не быть: cookie всё равно очищены
  }
  return Response.json({ ok: true });
}
