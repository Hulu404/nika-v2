import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { TipsContent } from "@/components/tips/TipsContent";
import type { PersonalTip } from "@/types/app";

/**
 * Раздел «Советы»: личная лента (без гейта, как /rhythm). Контента-заглушки нет —
 * страницу наполняют личные советы, которые НИКА сохранила из разговора
 * (personal_tips, RLS). До первого совета — пустое состояние.
 */
export default async function TipsPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let tips: PersonalTip[] = [];
  if (user) {
    const { data } = await supabase
      .from("personal_tips")
      .select("id, category, title, body, created_at")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    tips = (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
    }));
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Советы" subtitle="от Ники" />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <TipsContent initialTips={tips} userId={user?.id ?? null} />
      </div>
    </AppLayout>
  );
}
