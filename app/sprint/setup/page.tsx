import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";
import { getActiveSprint } from "@/lib/sprint";
import { SetupWizard } from "@/components/sprint/SetupWizard";

export default async function SprintSetupPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/sprint/setup");

  const [{ data: userData }, activeSprint] = await Promise.all([
    supabase.from("users").select("is_pro").eq("id", user.id).maybeSingle(),
    getActiveSprint(supabase, user.id),
  ]);

  if (!resolveIsPro(userData?.is_pro)) redirect("/upgrade");
  if (activeSprint) redirect("/sprint");

  return <SetupWizard userId={user.id} />;
}
