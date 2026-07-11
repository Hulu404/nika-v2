import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { TipsContent } from "@/components/tips/TipsContent";

/**
 * Раздел «Советы»: общий для всех профилей (без гейта, в отличие от /rhythm).
 * Контент статический из lib/tips/data.ts. Закладки: для залогиненного грузим
 * его сохранённые id (saved_tips, RLS), для гостя пустой набор + локальный
 * стейт до входа.
 */
export default async function TipsPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let savedIds: number[] = [];
  if (user) {
    const { data } = await supabase
      .from("saved_tips")
      .select("tip_id")
      .eq("user_id", user.id);
    savedIds = (data ?? []).map((r) => r.tip_id);
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Советы" subtitle="для бегунов" />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <TipsContent initialSavedIds={savedIds} userId={user?.id ?? null} />
      </div>
    </AppLayout>
  );
}
