import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";

export default async function Home() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: userData } = await supabase
      .from("users")
      .select("created_at")
      .eq("id", user.id)
      .maybeSingle();

    const hoursSince = userData?.created_at
      ? (Date.now() - new Date(userData.created_at).getTime()) / (1000 * 60 * 60)
      : 999;

    // Первые 24 часа — на экран первого дня
    if (hoursSince < 24) redirect("/day1");

    // Всё остальное время — на главный экран
    redirect("/today");
  }

  redirect("/auth");
}
