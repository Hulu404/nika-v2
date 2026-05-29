import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { ProfileContent } from "@/components/ProfileContent";

export default async function ProfilePage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/profile");

  const [{ data: userData }, { data: profileData }] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, email, is_pro, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("reminder_enabled")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <ProfileContent
        userId={user.id}
        initialName={userData?.display_name ?? ""}
        email={userData?.email ?? user.email ?? ""}
        isPro={userData?.is_pro ?? false}
        reminderEnabled={profileData?.reminder_enabled ?? false}
        createdAt={userData?.created_at ?? user.created_at ?? new Date().toISOString()}
      />
    </AppLayout>
  );
}
