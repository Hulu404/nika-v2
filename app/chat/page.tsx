import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";

/**
 * /chat → редирект на последний активный диалог пользователя.
 * Если диалогов нет — на /chat/general.
 */
export default async function ChatIndexPage() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/chat");

  const { data: last } = await supabase
    .from("conversations")
    .select("scenario")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  redirect(last ? `/chat/${last.scenario}` : "/chat/general");
}
