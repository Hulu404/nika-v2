import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { ProfileContent } from "@/components/ProfileContent";
import { resolveIsPro } from "@/lib/subscription";

export default async function ProfilePage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/profile");

  const [{ data: userData }, profileResult] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, email, is_pro, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("reminder_enabled, gender, proactive, notif_time, notif_frequency")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // Если запрос упал (например, колонки из миграции 017 ещё не созданы),
  // перечитываем без новых полей — базовые настройки должны работать всегда.
  let profileData = profileResult.error ? null : profileResult.data;
  if (profileResult.error) {
    const { data: basic } = await supabase
      .from("profiles")
      .select("reminder_enabled, gender, proactive")
      .eq("user_id", user.id)
      .maybeSingle();
    profileData = basic ? { ...basic, notif_time: null, notif_frequency: null } : null;
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <ProfileContent
        userId={user.id}
        initialName={userData?.display_name ?? ""}
        email={userData?.email ?? user.email ?? ""}
        isPro={resolveIsPro(userData?.is_pro)}
        reminderEnabled={profileData?.reminder_enabled ?? false}
        initialGender={profileData?.gender ?? null}
        initialProactive={profileData?.proactive ?? false}
        initialNotifTime={(profileData?.notif_time as string | null) ?? "08:00"}
        initialNotifFrequency={(profileData?.notif_frequency as string | null) ?? "daily"}
        createdAt={userData?.created_at ?? user.created_at ?? new Date().toISOString()}
      />
    </AppLayout>
  );
}
