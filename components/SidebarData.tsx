import { Sidebar, type RecentConvo } from "@/components/Sidebar";
import { SCENARIO_META } from "@/lib/scenarios";
import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";
import { showRhythm } from "@/lib/profile";

const MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function formatTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export async function SidebarData() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let recentConvos: RecentConvo[] = [];
  let isPro = resolveIsPro(undefined);
  let rhythm = false;

  if (user) {
    const [{ data: convData }, { data: userRow }, { data: profileRow }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, scenario, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase.from("users").select("is_pro").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("gender, cycle").eq("user_id", user.id).maybeSingle(),
    ]);

    recentConvos = (convData ?? []).map((c) => ({
      label: SCENARIO_META[c.scenario as keyof typeof SCENARIO_META]?.title ?? c.scenario,
      time: formatTime(c.updated_at),
      href: `/chat/${c.scenario}`,
    }));

    isPro = resolveIsPro(userRow?.is_pro);
    rhythm = showRhythm(profileRow?.gender, profileRow?.cycle);
  }

  return <Sidebar recentConvos={recentConvos} isPro={isPro} showRhythm={rhythm} />;
}
