import { redirect } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";
import { getActiveSprint } from "@/lib/sprint";
import { SprintDashboard } from "@/components/sprint/SprintDashboard";
import { getRuns } from "@/lib/runs";
import { buildMoodChart, buildWordCloud } from "@/lib/analytics";
export default async function SprintPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/sprint");

  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [{ data: userData }, sprint, runs, { data: convs }] = await Promise.all([
    supabase.from("users").select("is_pro").eq("id", user.id).maybeSingle(),
    getActiveSprint(supabase, user.id),
    getRuns(supabase, user.id),
    supabase.from("conversations").select("messages, updated_at").eq("user_id", user.id).gte("updated_at", since.toISOString()),
  ]);

  if (!resolveIsPro(userData?.is_pro)) redirect("/upgrade");
  if (!sprint) redirect("/sprint/setup");

  const days = buildMoodChart(runs);
  const words = buildWordCloud(
    (convs ?? []).map((c) => ({ messages: c.messages as import("@/types/app").Message[] })),
  );

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Спринт" />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 lg:px-8 lg:pt-10 xl:max-w-[920px] 2xl:max-w-[1080px]">
          <SprintDashboard
            sprint={sprint}
            userId={user.id}
            chartDays={days}
            wordFreqs={words}
            convCount={(convs ?? []).length}
          />
        </div>
      </div>
    </AppLayout>
  );
}
