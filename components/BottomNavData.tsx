import { BottomNav } from "@/components/BottomNav";
import { createServerComponentClient } from "@/lib/supabase";
import { showRhythm } from "@/lib/profile";

/** Серверный враппер: подставляет в мобильную панель раздел «Мой ритм» по роду. */
export async function BottomNavData() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let rhythm = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("gender")
      .eq("user_id", user.id)
      .maybeSingle();
    rhythm = showRhythm(data?.gender);
  }

  return <BottomNav showRhythm={rhythm} />;
}
