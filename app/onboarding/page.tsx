import { redirect } from "next/navigation";
import { ChatOnboarding } from "@/components/onboarding/ChatOnboarding";
import { PageTransition } from "@/components/PageTransition";
import { getOrCreateProfile, isProfileComplete } from "@/lib/profile";
import { createServerComponentClient } from "@/lib/supabase";

export default async function OnboardingPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Гейтинг дублирует middleware, но защищает страницу и при прямом заходе.
  if (!user) {
    redirect("/auth?next=/onboarding");
  }

  const profile = await getOrCreateProfile(supabase, user.id);
  if (isProfileComplete(profile)) {
    redirect("/");
  }

  return (
    <PageTransition>
      <ChatOnboarding userId={user.id} />
    </PageTransition>
  );
}
