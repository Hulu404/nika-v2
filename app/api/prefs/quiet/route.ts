import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Переключатель тихого режима (notification_prefs.quiet_mode). Апсерт делаем
 * сервисным ключом: у notification_prefs есть RLS UPDATE для владельца, но нет
 * INSERT, а строки может ещё не быть.
 */
export async function POST(req: Request) {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let quiet = false;
  try {
    quiet = Boolean((await req.json())?.quiet_mode);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("notification_prefs")
    .upsert({ user_id: user.id, quiet_mode: quiet }, { onConflict: "user_id" });
  if (error) return Response.json({ error: "DB error" }, { status: 500 });

  return Response.json({ ok: true, quiet_mode: quiet });
}
