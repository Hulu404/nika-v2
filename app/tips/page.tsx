import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { TipsContent } from "@/components/tips/TipsContent";
import { BasicTips } from "@/components/tips/BasicTips";
import type { PersonalTip } from "@/types/app";

/**
 * Раздел «Советы» (без гейта, как /rhythm):
 * — PRO видит личную ленту из диалога (personal_tips, RLS), пополняемую save_tip;
 * — FREE видит статичную базовую подборку (read-only), без пополнения из чата.
 */
export default async function TipsPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isPro = false;
  let tips: PersonalTip[] = [];
  if (user) {
    const { data: userData } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", user.id)
      .maybeSingle();
    isPro = resolveIsPro(userData?.is_pro);

    if (isPro) {
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
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Советы" subtitle={isPro ? "от Ники" : "для бегунов"} />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        {isPro ? (
          <>
            <TipsContent initialTips={tips} userId={user?.id ?? null} />
            <BasicTips showAsSection />
          </>
        ) : (
          <BasicTips />
        )}
      </div>
    </AppLayout>
  );
}
