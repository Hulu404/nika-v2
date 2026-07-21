import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { ProfileContent } from "@/components/ProfileContent";
import { resolveIsPro } from "@/lib/subscription";
import { isTelegramAllowed } from "@/lib/telegram/allowlist";

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

  // Активная Telegram-связка (для кнопки «Подключить/Отключить»). Таблица
  // tg_bindings из миграции 019 может ещё не существовать — тогда просто false.
  const bindingResult = await supabase
    .from("tg_bindings")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const telegramLinked = !bindingResult.error && bindingResult.data != null;

  // Бот заблокирован пользователем (Промт 7): предложим мягко переподключить.
  const blockedResult = await supabase
    .from("tg_bindings")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", false)
    .eq("unlink_reason", "blocked")
    .limit(1)
    .maybeSingle();
  const telegramBlocked = !telegramLinked && !blockedResult.error && blockedResult.data != null;

  // Настройки уведомлений (notification_prefs). Читаем тихий режим + поля
  // утреннего нуджа. Если новых колонок ещё нет (миграция 023) — фолбэк на quiet.
  const prefsResult = await supabase
    .from("notification_prefs")
    .select("quiet_mode, morning_enabled, morning_time, pause_until")
    .eq("user_id", user.id)
    .maybeSingle();
  let prefsData:
    | { quiet_mode?: boolean | null; morning_enabled?: boolean | null; morning_time?: string | null; pause_until?: string | null }
    | null = prefsResult.error ? null : prefsResult.data;
  if (prefsResult.error) {
    const { data: basicPrefs } = await supabase
      .from("notification_prefs")
      .select("quiet_mode")
      .eq("user_id", user.id)
      .maybeSingle();
    prefsData = basicPrefs
      ? { ...basicPrefs, morning_enabled: null, morning_time: null, pause_until: null }
      : null;
  }
  const quietMode = prefsData?.quiet_mode === true;
  const morningEnabled = prefsData?.morning_enabled ?? true; // дефолт вкл.
  const morningTime = (prefsData?.morning_time as string | null)?.slice(0, 5) ?? "08:00";
  const pauseUntil = (prefsData?.pause_until as string | null) ?? null;

  // Тест-режим: подключение Telegram доступно только пользователям из allowlist.
  const email = userData?.email ?? user.email ?? "";
  const telegramAllowed = isTelegramAllowed(email);

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <ProfileContent
        userId={user.id}
        initialName={userData?.display_name ?? ""}
        email={email}
        isPro={resolveIsPro(userData?.is_pro)}
        reminderEnabled={profileData?.reminder_enabled ?? false}
        initialGender={profileData?.gender ?? null}
        initialProactive={profileData?.proactive ?? false}
        initialNotifTime={(profileData?.notif_time as string | null) ?? "08:00"}
        initialNotifFrequency={(profileData?.notif_frequency as string | null) ?? "daily"}
        initialTelegramLinked={telegramLinked}
        initialTelegramBlocked={telegramBlocked}
        initialTelegramAllowed={telegramAllowed}
        initialQuietMode={quietMode}
        initialMorningEnabled={morningEnabled}
        initialMorningTime={morningTime}
        initialPauseUntil={pauseUntil}
        createdAt={userData?.created_at ?? user.created_at ?? new Date().toISOString()}
      />
    </AppLayout>
  );
}
