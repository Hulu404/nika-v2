import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/types/database";
import type { CyclePref, Gender, NotifPermission } from "@/types/app";

type Client = SupabaseClient<Database>;

/** Читает профиль пользователя или null, если его ещё нет. */
export async function getProfile(
  supabase: Client,
  userId: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Возвращает профиль пользователя, создавая пустую запись при первом обращении.
 * Принимает клиент параметром, чтобы переиспользоваться и в серверных
 * компонентах, и в middleware (у них разные инстансы Supabase-клиента).
 */
export async function getOrCreateProfile(
  supabase: Client,
  userId: string,
): Promise<Profile | null> {
  const existing = await getProfile(supabase, userId);
  if (existing) return existing;

  const { data } = await supabase
    .from("profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return data ?? null;
}

/**
 * Онбординг считается пройденным, когда указан род. Новый чат-онбординг
 * больше не собирает goal — сигналом завершённости стал gender, который
 * шаг «Обращение» задаёт всегда. Прежние пользователи (у них gender тоже
 * заполнялся) остаются пройденными.
 */
export function isProfileComplete(profile: Profile | null): boolean {
  return profile?.gender != null;
}

/**
 * Видимость раздела «Мой ритм» — только для женского рода. Единая точка
 * правила: и навигация, и серверная защита страницы ссылаются сюда.
 */
export const showRhythm = (gender?: string | null): boolean => gender === "female";

export interface OnboardingInput {
  name: string;
  gender: Gender;
  cycle?: CyclePref | null;
  proactive?: boolean | null;
  notifPermission?: NotifPermission | null;
}

/**
 * Сохраняет ответы чат-онбординга: поля профиля — в profiles (upsert по
 * user_id), имя — в users.display_name. Возвращает текст ошибки или null.
 * gender сейчас 'male' | 'female' (enum в БД без 'neutral' — см. миграции).
 */
export async function saveOnboarding(
  supabase: Client,
  userId: string,
  input: OnboardingInput,
): Promise<string | null> {
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      gender: input.gender,
      cycle: input.cycle ?? null,
      proactive: input.proactive ?? null,
      notif_permission: input.notifPermission ?? null,
    },
    { onConflict: "user_id" },
  );
  if (error) return error.message;

  const name = input.name.trim();
  if (name) {
    const { error: nameError } = await supabase
      .from("users")
      .update({ display_name: name })
      .eq("id", userId);
    if (nameError) return nameError.message;
  }

  return null;
}
