import { BottomNav } from "@/components/BottomNav";
import { createServerComponentClient } from "@/lib/supabase";

/**
 * Серверный враппер: отдаёт бару род и cycle. Читается на каждом серверном
 * рендере, поэтому router.refresh() после смены рода/cycle перестраивает вкладки.
 */
export async function BottomNavData() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let gender: string | null = null;
  let cycle: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("gender, cycle")
      .eq("user_id", user.id)
      .maybeSingle();
    gender = data?.gender ?? null;
    cycle = data?.cycle ?? null;
  }

  return <BottomNav gender={gender} cycle={cycle} />;
}
