import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";

export default async function Home() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const [{ data: userData }, { data: convData }] = await Promise.all([
      supabase.from("users").select("created_at").eq("id", user.id).maybeSingle(),
      supabase.from("conversations").select("id").eq("user_id", user.id).limit(1),
    ]);

    const hoursSince = userData?.created_at
      ? (Date.now() - new Date(userData.created_at).getTime()) / (1000 * 60 * 60)
      : 999;

    // Первые 24 часа — всегда на /day1
    if (hoursSince < 24) redirect("/day1");

    // После 24 часов с разговорами — на /today
    if ((convData?.length ?? 0) > 0) redirect("/today");
  }

  redirect("/day1");
}
