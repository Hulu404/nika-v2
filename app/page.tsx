import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";

export default async function Home() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: convData } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if ((convData?.length ?? 0) > 0) {
      redirect("/today");
    }
  }

  redirect("/day1");
}
