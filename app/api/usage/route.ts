import { createServerComponentClient } from "@/lib/supabase";
import { getTodayUsage } from "@/lib/limits";
import { planConfig } from "@/lib/plans/limits-config";
import { resolveTier } from "@/lib/subscription";
import { FORCE_PRO_FOR_ALL } from "@/lib/subscription";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userRow } = await supabase
    .from("users")
    .select("is_pro")
    .eq("id", user.id)
    .maybeSingle();

  const tier = resolveTier(userRow?.is_pro);
  const config = planConfig(tier);

  // Когда FORCE_PRO_FOR_ALL — лимиты отключены, возвращаем «безлимит»
  if (FORCE_PRO_FOR_ALL) {
    return Response.json({ used: 0, limit: config.daily_units, tier, resetAtMidnight: true });
  }

  const usage = await getTodayUsage(supabase, user.id, config);

  // Время до сброса (начало следующих суток по UTC)
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  const msUntilReset = nextMidnight.getTime() - now.getTime();

  return Response.json({
    used: usage.units,
    limit: config.daily_units,
    tier,
    msUntilReset,
  });
}
