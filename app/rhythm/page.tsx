import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { MobileHeader } from "@/components/journal/MobileHeader";
import { getProfile, showRhythm } from "@/lib/profile";

export default async function RhythmPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/rhythm");

  // Раздел только для женского рода — закрываем и прямой переход по ссылке.
  const profile = await getProfile(supabase, user.id);
  if (!showRhythm(profile?.gender)) redirect("/");

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <MobileHeader title="Мой ритм" />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[640px] px-6 pt-10 lg:pt-16">
          <div className="rounded-card border border-line-default bg-surface-warm p-7 lg:p-9">
            <span className="mb-6 block h-14 w-14 rounded-full bg-nika-avatar shadow-card" aria-hidden />
            <h1 className="font-serif text-[30px] font-normal leading-tight tracking-[-0.02em] text-ink-primary lg:text-[36px]">
              Мой ритм
            </h1>
            <p className="mt-4 max-w-[48ch] text-[15px] leading-[1.65] text-ink-secondary lg:text-[16px]">
              Здесь будет место, где мы вместе учитываем твой ритм. В тяжёлые дни я буду бережнее, без гонки. Скоро тут появится больше.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
