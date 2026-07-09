import { BottomNav } from "@/components/BottomNav";
import { createServerComponentClient } from "@/lib/supabase";

/**
 * Серверный враппер: отдаёт баром текущий род. Читается на каждом серверном
 * рендере, поэтому router.refresh() после смены рода перестраивает вкладки.
 */
export async function BottomNavData() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let gender: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("gender")
      .eq("user_id", user.id)
      .maybeSingle();
    gender = data?.gender ?? null;
  }

  return <BottomNav gender={gender} />;
}
